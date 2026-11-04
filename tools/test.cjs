'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=[];
function collect(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()&&entry.name!=='fixtures')collect(file);
    else if(entry.isFile()&&entry.name.endsWith('.test.js'))files.push(file);
  }
}
collect(path.join(root,'tests'));files.sort();
if(!files.length)throw Error('No Node regression tests found');
// Avoid spawning dozens of file-heavy suites at once on high-core Windows
// machines, where transient file locks can invalidate an otherwise good run.
const concurrency=Math.min(16,Math.max(1,os.availableParallelism()-1));
const result=spawnSync(process.execPath,['--test',`--test-concurrency=${concurrency}`,...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
