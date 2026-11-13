// Kịch bản giả lập 100 người dùng cùng lúc quét bản đồ & kiểm tra lừa đảo
const TARGET_URL = 'http://localhost:3000';
const CONCURRENT_USERS = 100;

async function runStressTest() {
  console.log(`Bat dau ban ${CONCURRENT_USERS} luong truy cap dong thoi vao QIWAI...`);
  const startTime = Date.now();

  const requests = Array.from({ length: CONCURRENT_USERS }, (_, i) => {
    // Chia đều: 50% quét bản đồ Urban, 50% kiểm tra Shield Cache
    if (i % 2 === 0) {
      return fetch(`${TARGET_URL}/api/v1/urban/pulses?lat=10.8425&lng=106.6132`);
    } else {
      return fetch(`${TARGET_URL}/api/v1/shield/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'URL',
          content: 'http://vcb-xacthuc-baomat.xyz'
        })
      });
    }
  });

  const results = await Promise.allSettled(requests);
  const duration = Date.now() - startTime;

  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
  const blockedCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 429).length;
  const errorCount = results.length - successCount - blockedCount;

  console.log('--- KET QUA KIEM THU CHIU TAI ---');
  console.log(`Tong thoi gian xu ly: ${duration}ms`);
  console.log(`Thanh cong (200 OK): ${successCount}`);
  console.log(`Bi chan chong spam (429): ${blockedCount}`);
  console.log(`Loi / Sap ket noi: ${errorCount}`);
}

runStressTest();
