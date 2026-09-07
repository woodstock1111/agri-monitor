import importlib.util, tempfile, unittest
from pathlib import Path
import numpy as np
from netCDF4 import Dataset
spec=importlib.util.spec_from_file_location('soil',Path(__file__).resolve().parents[1]/'scripts/china-soil-query.py')
soil=importlib.util.module_from_spec(spec);spec.loader.exec_module(soil)

class SoilTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name)
        for key in soil.FIELDS:
            with Dataset(self.directory/(key+'-surface.nc'),'w') as d:
                d.createDimension('lat',2);d.createDimension('lon',2)
                d.createVariable('lat','f4',('lat',))[:]=[20,20+1/120]
                d.createVariable('lon','f4',('lon',))[:]=[110,110+1/120]
                v=d.createVariable(key,'f4',('lat','lon'),fill_value=-999)
                v.units={'PH':'','BD':'g/cm3','SOM':'% of weight'}.get(key,'ppm of weight')
                value={'PH':6,'BD':1.3,'SOM':2}.get(key,100)
                v[:]=[[value,-999],[value,value]]
    def tearDown(self):self.temp.cleanup()
    def test_units_and_location(self):
        r=soil.query(self.directory,20,110)
        self.assertTrue(r['ok']);self.assertEqual(r['fields']['organicMatter']['value'],20)
        self.assertEqual(r['fields']['availableN']['unit'],'mg/kg')
        self.assertEqual(r['depthCm'],[0,4.5])
    def test_no_nearest_valid_substitution(self):
        self.assertEqual(soil.query(self.directory,20,110+1/120)['status'],'no_data')
    def test_outside_grid_and_missing(self):
        self.assertEqual(soil.query(self.directory,49,-123)['status'],'outside_coverage')
        self.assertEqual(soil.query(self.directory,30,120)['status'],'outside_coverage')
        (self.directory/'AN-surface.nc').unlink()
        self.assertEqual(soil.query(self.directory,20,110)['status'],'data_pending')
    def test_unknown_units_rejected(self):
        with Dataset(self.directory/'AN-surface.nc','a') as d:d['AN'].units='g/kg'
        with self.assertRaises(ValueError):soil.query(self.directory,20,110)

if __name__=='__main__':unittest.main()
