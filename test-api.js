// Quick API exploration script
const http = require('http');

const BASE = 'http://www.0531yun.com';

function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (token) headers['authorization'] = token;
    
    http.get(url.toString(), { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Step 1: Get token
  console.log('=== 1. Getting Token ===');
  const tokenRes = await apiGet('/api/getToken?loginName=h260415rdny&password=h260415rdny');
  console.log(JSON.stringify(tokenRes, null, 2));
  
  if (tokenRes.code !== 1000) { console.log('Auth failed!'); return; }
  const token = tokenRes.data.token;
  console.log('Token acquired, expires:', new Date(tokenRes.data.expiration * 1000).toLocaleString());
  
  // Step 2: Get device list
  console.log('\n=== 2. Device List ===');
  const deviceList = await apiGet('/api/device/getDeviceList', token);
  console.log(JSON.stringify(deviceList, null, 2).substring(0, 3000));
  
  // Step 3: Get group list
  console.log('\n=== 3. Group List ===');
  const groupList = await apiGet('/api/device/getGroupList', token);
  console.log(JSON.stringify(groupList, null, 2).substring(0, 2000));
  
  // Step 4: If we found devices, get real-time data for first one
  if (deviceList.code === 1000 && deviceList.data && deviceList.data.length > 0) {
    const firstAddr = deviceList.data[0].deviceAddr;
    console.log(`\n=== 4. Real-Time Data for device ${firstAddr} ===`);
    const rtData = await apiGet(`/api/data/getRealTimeDataByDeviceAddr?deviceAddrs=${firstAddr}`, token);
    console.log(JSON.stringify(rtData, null, 2).substring(0, 3000));
    
    // Step 5: Get device info
    console.log(`\n=== 5. Device Info for ${firstAddr} ===`);
    const devInfo = await apiGet(`/api/device/getDevice?deviceAddr=${firstAddr}`, token);
    console.log(JSON.stringify(devInfo, null, 2).substring(0, 3000));
  }
}

main().catch(console.error);
