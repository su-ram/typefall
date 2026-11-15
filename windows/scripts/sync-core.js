// 공용 효과 엔진(shared/typefall-core.js)을 앱 소스로 복사한다 (생성 파일은 git 에 올리지 않음)
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'shared', 'typefall-core.js');
const dst = path.join(__dirname, '..', 'src', 'typefall-core.js');
fs.copyFileSync(src, dst);
console.log('synced core →', path.relative(process.cwd(), dst));
