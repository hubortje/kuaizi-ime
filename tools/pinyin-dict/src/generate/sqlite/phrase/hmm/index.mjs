/* 生成 HMM 计算参数 */
import {
  fromRootPath,
  appendLineToFile,
  getAllFiles,
  readFile
} from '../../../../utils/utils.mjs';
import { openDB, closeDB } from '../../../../utils/sqlite.mjs';
import * as hmm from './hmm.mjs';

// 样本文件目录。可试用样本如下：
// - https://raw.githubusercontent.com/InsaneLife/ChineseNLPCorpus/master/NER/MSRA/train1.txt
// - https://raw.githubusercontent.com/InsaneLife/ChineseNLPCorpus/master/NER/renMinRiBao/renmin.txt
// - https://pan.baidu.com/s/1LDwQjoj7qc-HT9qwhJ3rcA 提取码: 1fa3
let phraseSamplesDir = '';
let appendExistData = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg == '-f') {
    phraseSamplesDir = args[++i];
  } else if (arg == '-a') {
    appendExistData = true;
  }
}

if (!phraseSamplesDir) {
  console.log(
    'Usage: npm run generate:sqlite:phrase:hmm -- [-a] -f /path/to/samples/file'
  );
  console.log();

  process.exit(1);
}

// SQLite 字典库
const wordDictSQLiteFile = fromRootPath('data', 'pinyin-word-dict.sqlite');
// HMM 参数目录
const hmmParamsDir = fromRootPath('data', 'hmm_params');

console.log();
console.log('创建 HMM 计算参数 ...');
let wordDictDB = await openDB(wordDictSQLiteFile, true);

let words;
try {
  words = await hmm.readWords(wordDictDB);
} catch (e) {
  throw e;
} finally {
  await closeDB(wordDictDB);
}

let hmmParams;
getAllFiles(phraseSamplesDir).forEach((file) => {
  const debugSuffix = '.debug';
  if (file.endsWith(debugSuffix)) {
    return;
  }

  // console.log(`- 分析文件: ${file} ...`);

  const sampleText = readFile(file);

  hmmParams = hmm.countParams(
    sampleText,
    words,
    hmmParams
    // , `${file}${debugSuffix}`
  );
});

Object.keys(hmmParams).forEach((name) => {
  appendLineToFile(
    hmmParamsDir + `/${name}.json`,
    JSON.stringify(hmmParams[name], null, 2),
    true
  );
});

console.log();
console.log('Done');
console.log();
