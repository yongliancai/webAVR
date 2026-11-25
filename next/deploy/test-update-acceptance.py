import importlib.util,io,tarfile,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('updater',Path(__file__).with_name('update-acceptance.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReleasePaths(unittest.TestCase):
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
