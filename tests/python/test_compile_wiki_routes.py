"""Offline tests for preserving reviewed routing data across wiki recompiles."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('compile_wiki_routes',
                                              ROOT / 'tools' / 'data' / 'compile-wiki-routes.py')
compiler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compiler)


class CompileWikiRoutesTest(unittest.TestCase):
    def compile_42(self, change_sha=False, nga_primary=False):
        with tempfile.TemporaryDirectory() as dirname:
            base = Path(dirname)
            staged_dir, out_dir = base / 'staged', base / 'out'
            staged_dir.mkdir()
            out_dir.mkdir()
            # Synthetic parser input; captured wiki pages are kept outside the repository.
            prior = json.loads((ROOT / 'data' / 'normal_routes' / '4-2.json').read_text(encoding='utf-8'))
            staged = {'area': '4-2', 'url': 'https://example.invalid/test-map',
                      'sha256': prior['source']['branchSectionSha256'], 'bossNodes': ['L'],
                      'terminalNodes': [], 'section': ''}
            rows = []
            for point in prior['branchPoints']:
                if point['from'] == 'B':  # supplied manually, deliberately absent from the synthetic table
                    continue
                origin = '出撃' if point['from'] == 'start' else point['from']
                for i, destination in enumerate(point['destinations']):
                    rows.append(f"|{origin if i == 0 else '~'}|{destination}|テスト条件|")
            staged['section'] = '\n'.join(rows)
            if change_sha:
                staged['sha256'] = 'changed-source-hash'
            (staged_dir / '4-2.json').write_text(json.dumps(staged, ensure_ascii=False), encoding='utf-8')
            prior = json.loads((ROOT / 'data' / 'normal_routes' / '4-2.json').read_text(encoding='utf-8'))
            if not nga_primary:
                prior['source'].pop('authority', None)
            (out_dir / '4-2.json').write_text(json.dumps(prior, ensure_ascii=False), encoding='utf-8')
            old_staged, old_out = compiler.STAGED, compiler.OUT
            try:
                compiler.STAGED, compiler.OUT = staged_dir, out_dir
                with contextlib.redirect_stdout(io.StringIO()):
                    compiler.main()
            finally:
                compiler.STAGED, compiler.OUT = old_staged, old_out
            return json.loads((out_dir / '4-2.json').read_text(encoding='utf-8'))

    def test_manual_branch_survives_same_source(self):
        result = self.compile_42()
        self.assertTrue(any(point['from'] == 'B' for point in result['branchPoints']))
        self.assertIn('B', result['machineRules'])
        self.assertEqual(result['evaluation'], 'reviewed')
        self.assertTrue(result['graphComplete'])
        self.assertEqual(result['airControl']['profiles'][0]['id'], 'enRoute')

    def test_changed_source_invalidates_prior_review(self):
        result = self.compile_42(change_sha=True)
        self.assertTrue(any(point['from'] == 'B' for point in result['branchPoints']))
        self.assertEqual(result['evaluation'], 'partial')
        self.assertFalse(result['graphComplete'])

    def test_conflicting_fixed_edge_is_rejected(self):
        data = json.loads((ROOT / 'data' / 'normal_routes' / '4-3.json').read_text(encoding='utf-8'))
        data['fixedEdges']['K'] = 'L'
        self.assertTrue(any('K: fixed edge conflicts' in issue
                            for issue in compiler.graph_issues(data)))

    def test_wiki_refresh_cannot_overwrite_user_selected_nga_source(self):
        before = json.loads((ROOT / 'data' / 'normal_routes' / '4-2.json').read_text(encoding='utf-8'))
        self.assertEqual(self.compile_42(change_sha=True, nga_primary=True), before)


if __name__ == '__main__':
    unittest.main()
