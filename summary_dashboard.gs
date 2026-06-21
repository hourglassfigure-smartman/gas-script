/**
 * 売上データを月ごとに集計し、「月次サマリー」シートへ書き出して
 * 月次推移を棒グラフで可視化するスクリプト。
 *
 * 想定シート構成:
 *   ■「売上データ」シート
 *     A列: 日付（例 2026/01/05） / B列: 担当者名 / C列: 商品名 / D列: 金額（数値）
 *   ■「月次サマリー」シート（出力先・自動生成/上書き）
 *     A列: 月（例 2026年1月） / B列: 合計売上 / C列: 件数
 */

// シート名・設定値はここで一元管理する
const SOURCE_SHEET_NAME = '売上データ';   // 入力元シート名
const SUMMARY_SHEET_NAME = '月次サマリー'; // 出力先シート名
const TRIGGER_HOUR = 9;                    // 自動実行する時刻（時）

/**
 * メイン処理。売上データを集計してサマリーシートとグラフを更新する。
 * 毎朝のトリガーからもこの関数が呼ばれる。
 */
function updateSummaryDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 入力元シートを取得（存在しない場合はエラーを通知して終了）
  const sourceSheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  if (!sourceSheet) {
    throw new Error('「' + SOURCE_SHEET_NAME + '」シートが見つかりません。');
  }

  // 月ごとの集計を行う
  const monthlyData = aggregateByMonth(sourceSheet);

  // サマリーシートへ書き込む
  const summarySheet = writeSummarySheet(ss, monthlyData);

  // 棒グラフを作成（既存グラフは作り直す）
  buildMonthlyChart(summarySheet, monthlyData.length);
}

/**
 * 「売上データ」シートを読み込み、月ごとに合計売上・件数を集計する。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sourceSheet 入力元シート
 * @return {Array<{label: string, total: number, count: number, sortKey: string}>}
 *         月昇順にソート済みの集計結果配列
 */
function aggregateByMonth(sourceSheet) {
  const lastRow = sourceSheet.getLastRow();

  // ヘッダー行のみ、またはデータが無い場合は空配列を返す
  if (lastRow < 2) {
    return [];
  }

  // A列〜D列のデータ部分（2行目以降）をまとめて取得する
  const values = sourceSheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 月キー（YYYY-MM）をキーに集計用オブジェクトへ蓄積する
  const buckets = {};

  values.forEach(function (row) {
    const dateValue = row[0]; // A列: 日付
    const amount = row[3];     // D列: 金額

    // 日付が空、または日付として解釈できない行はスキップする
    const date = toDate(dateValue);
    if (!date) {
      return;
    }

    // 金額が数値でない行はスキップする
    const numericAmount = Number(amount);
    if (isNaN(numericAmount)) {
      return;
    }

    // 月キー（例 2026-01）と表示用ラベル（例 2026年1月）を生成する
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 0始まりなので+1
    const sortKey = year + '-' + ('0' + month).slice(-2);
    const label = year + '年' + month + '月';

    if (!buckets[sortKey]) {
      buckets[sortKey] = { label: label, total: 0, count: 0, sortKey: sortKey };
    }
    buckets[sortKey].total += numericAmount;
    buckets[sortKey].count += 1;
  });

  // オブジェクトを配列化し、月の昇順（sortKey順）に並べ替える
  return Object.keys(buckets)
    .sort()
    .map(function (key) {
      return buckets[key];
    });
}

/**
 * 様々な形式の値をDateオブジェクトへ変換する。
 * 変換できない場合は null を返す。
 *
 * @param {*} value セルの値（Date型 / 文字列 / 数値など）
 * @return {Date|null}
 */
function toDate(value) {
  // すでにDate型ならそのまま利用する
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value;
  }
  // 空文字・null・undefined は対象外
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  // 文字列や数値はDateへの変換を試みる
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 集計結果を「月次サマリー」シートへ書き込む。
 * シートが無ければ作成し、有れば毎回クリアしてから書き直す。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss スプレッドシート
 * @param {Array} monthlyData 集計結果配列
 * @return {GoogleAppsScript.Spreadsheet.Sheet} 書き込んだサマリーシート
 */
function writeSummarySheet(ss, monthlyData) {
  // サマリーシートを取得、無ければ新規作成する
  let summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  }

  // 既存の内容を毎回すべてクリアしてから書き直す
  summarySheet.clear();

  // ヘッダー行を用意する
  const rows = [['月', '合計売上', '件数']];

  // 集計結果を行データへ展開する
  monthlyData.forEach(function (item) {
    rows.push([item.label, item.total, item.count]);
  });

  // まとめて書き込む
  summarySheet.getRange(1, 1, rows.length, 3).setValues(rows);

  // 見やすさのための簡単な書式設定
  summarySheet.getRange(1, 1, 1, 3).setFontWeight('bold'); // ヘッダーを太字に
  if (monthlyData.length > 0) {
    // 合計売上列を金額表示（円・3桁区切り）にする
    summarySheet.getRange(2, 2, monthlyData.length, 1).setNumberFormat('#,##0"円"');
  }
  summarySheet.autoResizeColumns(1, 3); // 列幅を自動調整

  return summarySheet;
}

/**
 * 月次推移を表す棒グラフを作成する。
 * 既存の埋め込みグラフがあれば一旦すべて削除してから作り直す。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} summarySheet サマリーシート
 * @param {number} dataRowCount 集計データの行数（ヘッダー除く）
 */
function buildMonthlyChart(summarySheet, dataRowCount) {
  // 既存のグラフをすべて削除する（毎回作り直すため）
  summarySheet.getCharts().forEach(function (chart) {
    summarySheet.removeChart(chart);
  });

  // データが無い場合はグラフを作成しない
  if (dataRowCount < 1) {
    return;
  }

  // A列（月ラベル）とB列（合計売上）を対象範囲とする（ヘッダー含む）
  const range = summarySheet.getRange(1, 1, dataRowCount + 1, 2);

  // 棒グラフ（縦棒）を構築してシートへ埋め込む
  const chart = summarySheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(range)
    .setPosition(2, 5, 0, 0) // 2行目・E列あたりに配置
    .setOption('title', '月次売上推移')
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { title: '月' })
    .setOption('vAxis', { title: '合計売上' })
    .setOption('width', 600)
    .setOption('height', 371)
    .build();

  summarySheet.insertChart(chart);
}

/**
 * 毎朝9時に updateSummaryDashboard を自動実行するトリガーを登録する。
 *
 * 使い方:
 *   GASエディタでこの関数（setupDailyTrigger）を一度だけ実行する。
 *   以降は毎朝9時台に集計処理が自動で走るようになる。
 *
 * 二重登録を防ぐため、同じ関数の既存トリガーは削除してから登録し直す。
 */
function setupDailyTrigger() {
  // updateSummaryDashboard に対する既存トリガーを削除する
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'updateSummaryDashboard') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 毎日 TRIGGER_HOUR 時台に実行する時間主導型トリガーを作成する
  ScriptApp.newTrigger('updateSummaryDashboard')
    .timeBased()
    .everyDays(1)
    .atHour(TRIGGER_HOUR)
    .create();

  // 確認用ログ
  Logger.log('毎朝' + TRIGGER_HOUR + '時の自動実行トリガーを登録しました。');
}
