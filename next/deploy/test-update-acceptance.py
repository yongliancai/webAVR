import importlib.util,io,json,tarfile,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('updater',Path(__file__).with_name('update-acceptance.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReleasePaths(unittest.TestCase):
 def test_pm2_startup_banner(self):
  self.assertEqual(m.parse_pm2_list('\n[PM2] Spawning daemon\n[PM2] done\n[]\n'),[])
  self.assertEqual(m.parse_pm2_list('[{"pid":123,"pm2_env":{"status":"online"}}]')[0]['pid'],123)
  with self.assertRaises(RuntimeError):m.parse_pm2_list('[PM2] unable to list applications')
 def test_replaces_only_acceptance_application(self):
  calls=[]
  def fake_run(args,env=None):
   calls.append([str(a) for a in args])
   if args[1]=='jlist':return json.dumps([{'name':m.NAME,'pm2_env':{}},{'name':'unrelated','pm2_env':{}}])
   return ''
  with patch.object(m,'run',side_effect=fake_run):m.replace_application(Path('/tmp/new-release/ecosystem.json'),{'PM2_HOME':'isolated'})
  self.assertEqual(calls[1],['pm2','delete',m.NAME])
  self.assertEqual(calls[2],['pm2','start','/tmp/new-release/ecosystem.json','--update-env'])
  self.assertFalse(any('unrelated' in call for call in calls))
 def test_rejects_old_running_directory(self):
  app=Path('/tmp/new-release/next')
  state={'name':m.NAME,'pm2_env':{'status':'online','pm_cwd':'/tmp/old-release/next','pm_exec_path':'/tmp/old-release/next/studio/serve-acceptance-test.mjs'}}
  with self.assertRaises(RuntimeError):m.assert_running_release([state],app)
  state['pm2_env'].update(pm_cwd=str(app),pm_exec_path=str(app/'studio/serve-acceptance-test.mjs'))
  m.assert_running_release([state],app)
 def test_normal_source(self):
  t=tarfile.open(fileobj=io.BytesIO(),mode='w');i=tarfile.TarInfo('next/app.mjs');t.addfile(i)
  self.assertEqual(len(m.safe_members(t,Path('/tmp/release'))),1)
 def test_archive_escape(self):
  for name in ['../.ssh/key','/etc/passwd','next/../../prod','.env','next/../private']:
   with self.subTest(name=name):
    t=tarfile.open(fileobj=io.BytesIO(),mode='w');t.addfile(tarfile.TarInfo(name))
    with self.assertRaises(ValueError):m.safe_members(t,Path('/tmp/release'))
 def test_symlink_and_special_files(self):
  for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.CHRTYPE,tarfile.FIFOTYPE]:
   t=tarfile.open(fileobj=io.BytesIO(),mode='w');i=tarfile.TarInfo('next/link');i.type=kind;t.addfile(i)
   with self.assertRaises(ValueError):m.safe_members(t,Path('/tmp/release'))
if __name__=='__main__':unittest.main()
