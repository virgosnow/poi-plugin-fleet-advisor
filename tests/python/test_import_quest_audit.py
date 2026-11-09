import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('quest_audit_import', ROOT / 'tools/data/import-quest-audit.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class QuestAuditImportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audit = self.root / 'audit'
        self.audit.mkdir()
        (self.root / 'data/quests').mkdir(parents=True)
        (self.root / 'data/sortie/encounters').mkdir(parents=True)
        (self.root / 'data/sortie/enemy_catalog.json').write_text('{"enemies":[]}', encoding='utf8')
        (self.audit / 'download-manifest.json').write_text('[]', encoding='utf8')
        self.quest = {'code':'Cy12','category':'C','period':'年常','title':'春雨演習',
                      'wikiGameId':371,'gameIdCandidates':[371], 'url':'https://wikiwiki.jp/kancolle/任務/演習任務',
                      'fleet':{'allOf':[{'kind':'fleetSize','min':5}]},
                      'goals':[{'kind':'practice','rankMin':'S','count':5,'withinDay':True}]}
        self.audit_file = self.audit / 'converted-quests-v8.json'
        self.write_audit([self.quest])
        self.old = {'code':'P371','category':'C','period':'yearly','title':'春雨演習','ids':[371],
                    'wikiCode':'Cy12','fleet':{'allOf':[{'kind':'fleetSize','min':4}]},
                    'goals':[{'kind':'practice','rankMin':'A','count':4,'withinDay':True}],
                    'source':{'url':'https://wikiwiki.jp/kancolle/任務/演習任務'}}
        self.original = self.root / 'data/quests/requirements.json'
        self.original.write_text(json.dumps({'source':{},'quests':[self.old]}), encoding='utf8')
        self.output = self.root / 'output.json'

    def write_audit(self, quests):
        self.audit_file.write_text(json.dumps(quests, ensure_ascii=False), encoding='utf8')

    def run_import(self, *args):
        with patch.object(MODULE, 'ROOT', self.root), patch.object(sys, 'argv', ['import',str(self.audit),'--output',str(self.output),*args]), contextlib.redirect_stdout(io.StringIO()):
            MODULE.main()
        return json.loads(self.output.read_text(encoding='utf8'))

    def test_reviewed_rules_survive_reimport_and_audited_changes_can_be_accepted_per_quest(self):
        added = {**self.quest, 'code':'C77','wikiGameId':376,'gameIdCandidates':[376],'title':'新演習'}
        self.write_audit([self.quest, added])
        rows = {q['code']:q for q in self.run_import()['quests']}
        self.assertEqual(rows['P371']['fleet'], self.old['fleet'])
        self.assertEqual(rows['P371']['goals'], self.old['goals'])
        self.assertEqual(rows['P376']['wikiCode'], 'C77')
        rows = {q['code']:q for q in self.run_import('--accept-practice-change','P371')['quests']}
        self.assertEqual(rows['P371']['fleet'], self.quest['fleet'])
        self.assertEqual(rows['P371']['goals'], self.quest['goals'])

    def test_missing_or_changed_identity_cannot_silently_discard_reviewed_data(self):
        self.output.write_text('unchanged', encoding='utf8')
        self.write_audit([])
        with self.assertRaisesRegex(ValueError, 'omitted previously reviewed'):
            self.run_import()
        self.assertEqual(self.output.read_text(encoding='utf8'), 'unchanged')
        self.write_audit([{**self.quest,'title':'different quest'}])
        with self.assertRaisesRegex(ValueError, 'changed title'):
            self.run_import()
        self.assertEqual(self.output.read_text(encoding='utf8'), 'unchanged')

    def test_same_audit_preserves_previously_corrected_sortie_and_expedition_rules(self):
        sortie={'code':'B1','category':'B','period':'单次','title':'出撃','wikiGameId':201,
                'gameIdCandidates':[201],'url':'https://wikiwiki.jp/kancolle/任務',
                'fleet':{'allOf':[]},'goals':[{'kind':'battle','count':1}]}
        self.write_audit([self.quest,sortie])
        old_sortie={'code':'B1','category':'B','period':'单次','title':'出撃','ids':[201],
                    'fleet':{'allOf':[]},'goals':[{'kind':'battle','count':2}],'source':{'url':sortie['url']}}
        digest=hashlib.sha256(self.audit_file.read_bytes()).hexdigest()
        self.original.write_text(json.dumps({'source':{'auditSha256':digest},'quests':[self.old,old_sortie]}),encoding='utf8')
        rows={q['code']:q for q in self.run_import()['quests']}
        self.assertEqual(rows['B1'],old_sortie)


if __name__ == '__main__':
    unittest.main()
