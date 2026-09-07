#!/usr/bin/env python3
"""Extract the complete 0–4.5 cm layer from official CDF-1 ZIP streams.
The archive contains 8 value layers followed by 8 QC layers (~2 GB expanded).
Only publish an atomic surface file once the entire first layer has arrived.
A partial archive is explicitly allowed; never pad missing cells with zeros.
"""
import argparse, io, json, os, struct, zlib
from pathlib import Path
import numpy as np
from netCDF4 import Dataset

TYPES={1:('>i1',1),2:('S1',1),3:('>i2',2),4:('>i4',4),5:('>f4',4),6:('>f8',8)}

def header(data):
    f=io.BytesIO(data)
    if f.read(4)!=b'CDF\x01': raise ValueError('Expected official NetCDF classic CDF-1 file')
    u=lambda:struct.unpack('>I',f.read(4))[0]
    def name():
        n=u(); b=f.read(n);f.read((-n)%4);return b.decode('utf-8').strip('\0')
    def attrs():
        tag,count=u(),u(); result={}
        if tag not in (0,12):raise ValueError('Invalid attributes')
        for _ in range(count):
            key=name();typ,n=u(),u();dtype,size=TYPES[typ];raw=f.read(n*size);f.read((-n*size)%4)
            result[key]=raw.decode().strip('\0') if typ==2 else np.frombuffer(raw,dtype=dtype).tolist()
        return result
    if u()!=0:raise ValueError('Record variables not supported')
    tag,count=u(),u()
    if tag!=10:raise ValueError('Missing dimensions')
    dims=[(name(),u()) for _ in range(count)]; global_attrs=attrs();tag,count=u(),u()
    if tag!=11:raise ValueError('Missing variables')
    variables={}
    for _ in range(count):
        key=name(); nd=u();dimids=[u() for _ in range(nd)];a=attrs();typ,size,offset=u(),u(),u()
        variables[key]={'dims':[dims[i] for i in dimids],'attrs':a,'type':typ,'size':size,'offset':offset}
    return dims,global_attrs,variables

def prepare(archive, key, target):
    with open(archive,'rb') as f:
        h=f.read(30)
        if len(h)!=30:raise ValueError('Archive header not yet downloaded')
        sig,version,flags,method,tm,dt,crc,compressed,uncompressed,nlen,extra=struct.unpack('<IHHHHHIIIHH',h)
        if sig!=0x04034b50 or method!=8 or flags&1:raise ValueError('Unsupported ZIP entry')
        entry=f.read(nlen).decode();f.read(extra)
        if entry!=key+'.nc':raise ValueError('Unexpected archive entry')
        z=zlib.decompressobj(-15); data=bytearray(); required=None;variables=None
        while True:
            b=f.read(65536)
            if not b:break
            data.extend(z.decompress(b))
            if required is None and len(data)>65536:
                _,_,variables=header(data);v=variables[key]
                if [d[0] for d in v['dims']]!=['depth','lat','lon']:raise ValueError('Unexpected dimension order')
                rows,cols=v['dims'][1][1],v['dims'][2][1]
                if v['type']!=5:raise ValueError('Expected float32 values')
                required=v['offset']+rows*cols*4
            if required and len(data)>=required:break
    if not required or len(data)<required:raise ValueError(f'Surface layer still downloading: {len(data)} / {required or "unknown"} expanded bytes')
    def vector(key):
        v=variables[key];n=v['dims'][0][1];dtype,size=TYPES[v['type']]
        return np.frombuffer(data,dtype=dtype,count=n,offset=v['offset']).astype('float32')
    lat,lon,depth=vector('lat'),vector('lon'),vector('depth')
    if not np.isclose(depth[0],4.5):raise ValueError('Unexpected surface layer depth')
    values=np.frombuffer(data,dtype='>f4',count=rows*cols,offset=variables[key]['offset']).reshape(rows,cols)
    temp=target.with_suffix('.tmp.nc')
    try:
        with Dataset(temp,'w',format='NETCDF4') as out:
            out.createDimension('lat',rows);out.createDimension('lon',cols)
            out.createVariable('lat','f4',('lat',))[:]=lat
            out.createVariable('lon','f4',('lon',))[:]=lon
            fill=float(variables[key]['attrs']['missing_value'][0])
            v=out.createVariable(key,'f4',('lat','lon'),fill_value=fill,zlib=True,complevel=4,chunksizes=(128,128))
            v[:]=values
            v.units=variables[key]['attrs'].get('units','')
            v.long_name=variables[key]['attrs'].get('long_name',key)
            out.depth_top_cm=0.;out.depth_bottom_cm=4.5
            out.source_doi='10.11888/Soil.tpdc.270281'
            out.source_period='1980s';out.source_archive=archive.name
            out.license='CC BY-NC-SA 4.0'
            out.attribution='Dai and Shangguan (2019); Shangguan et al. (2013), doi:10.1002/jame.20026'
            out.source_archive_crc32=hex(crc)
            out.qc_status='QC layer not included; source missing_value applied. No archive CRC validation on surface-only extraction.'
        os.replace(temp,target)
    finally:
        if temp.exists():temp.unlink()
    return {'key':key,'path':str(target),'units':variables[key]['attrs'].get('units'),'depth_cm':[0,4.5],'grid':[rows,cols]}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--directory',default='server-data/china-soil');p.add_argument('--keys',nargs='+',default=['AN','AP','AK','PH','BD','SOM']);args=p.parse_args()
    for key in args.keys:
        try:
            archive=Path(args.directory)/(key+'.zip')
            if not archive.exists():archive=Path(args.directory)/(key+'.zip.part')
            print(json.dumps(prepare(archive,key,Path(args.directory)/(key+'-surface.nc')),ensure_ascii=False))
        except (ValueError,FileNotFoundError,zlib.error) as e:print(json.dumps({'key':key,'pending':str(e)},ensure_ascii=False))
