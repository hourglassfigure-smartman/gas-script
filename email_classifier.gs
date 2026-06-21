/**
 * Gmailの「要処理」ラベル付き未読メールをClaude APIで分類し、
 * スプレッドシートに記録 → Slack通知 → ラベル付け替えまでを自動化するスクリプト。
 *
 * 処理の流れ:
 *   1. 「要処理」ラベルがついた未読メールを取得
 *   2. 本文をClaude API（claude-haiku-4-5）へ送り「クレーム/質問/注文/その他」に分類＋要約
 *   3. 「メールログ」シートへ 受信日時・送信者・件名・分類・要約 の順で記録
 *   4. Slack Incoming Webhookで担当者へ通知（件名・分類・要約）
 *   5. 処理済みメールに「処理済み」ラベルを付け、「要処理」ラベルを外す
 *
 * APIキー類はスクリプトプロパティから取得する:
 *   CLAUDE_API_KEY    … Anthropic APIキー
 *   SLACK_WEBHOOK_URL … Slack Incoming Webhook の URL
 */

// 設定値はここで一元管理する
const TODO_LABEL_NAME = '要処理';        // 処理対象を示すラベル
const DONE_LABEL_NAME = '処理済み';      // 処理完了を示すラベル
const MAIL_LOG_SHEET_NAME = 'メールログ';  // 正常ログの出力先シート
const ERROR_LOG_SHEET_NAME = 'エラーログ'; // エラーログの出力先シート

// Claude API 関連の定数
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5'; // コストを抑えるため最新のHaikuを使用
const CLAUDE_API_VERSION = '2023-06-01';

// 分類の選択肢（この4種類のいずれかに分類させる）
const CATEGORIES = ['クレーム', '質問', '注文', 'その他'];

/**
 * メイン処理。要処理メールを順に分類・記録・通知し、ラベルを付け替える。
 * 5分おきのトリガーからこの関数が呼ばれる。
 */
function classifyTodoEmails() {
  // ラベルを取得。無ければ作成する
  const todoLabel = getOrCreateLabel(TODO_LABEL_NAME);
  const doneLabel = getOrCreateLabel(DONE_LABEL_NAME);

  // 「要処理」かつ「未読」のスレッドを検索する
  const threads = GmailApp.search('label:' + TODO_LABEL_NAME + ' is:unread');

  threads.forEach(function (thread) {
    // スレッド内の未読メッセージのみを処理対象とする
    const messages = thread.getMessages().filter(function (message) {
      return message.isUnread();
    });

    messages.forEach(function (message) {
      try {
        processSingleMessage(message);
      } catch (e) {
        // 1通の失敗で全体が止まらないよう、ここでエラーを捕捉して記録する
        logError('メール処理中のエラー', e, message);
      }
    });

    // スレッド単位でラベルを付け替える（Gmailのラベルはスレッド単位）
    try {
      thread.markRead();                 // 既読にする
      thread.addLabel(doneLabel);        // 「処理済み」を付与
      thread.removeLabel(todoLabel);     // 「要処理」を除去
    } catch (e) {
      logError('ラベル付け替え中のエラー', e, null);
    }
  });
}

/**
 * 1通のメールを分類し、シートへ記録し、Slackへ通知する。
 *
 * @param {GoogleAppsScript.Gmail.GmailMessage} message 処理対象のメール
 */
function processSingleMessage(message) {
  // メールの基本情報を取得する
  const receivedDate = message.getDate(); // 受信日時
  const sender = message.getFrom();        // 送信者
  const subject = message.getSubject();    // 件名
  const body = message.getPlainBody();     // 本文（プレーンテキスト）

  // Claude APIで分類と要約を取得する
  const result = classifyWithClaude(subject, body);
  const category = result.category; // 分類
  const summary = result.summary;   // 要約

  // スプレッドシートへ記録する（受信日時・送信者・件名・分類・要約の順）
  appendMailLog(receivedDate, sender, subject, category, summary);

  // Slackへ通知する（件名・分類・要約を含める）
  notifySlack(subject, category, summary);
}

/**
 * Claude APIにメール内容を送り、「クレーム/質問/注文/その他」への分類と要約を取得する。
 *
 * @param {string} subject 件名
 * @param {string} body 本文
 * @return {{category: string, summary: string}} 分類と要約
 */
function classifyWithClaude(subject, body) {
  // スクリプトプロパティからAPIキーを取得する
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    throw new Error('スクリプトプロパティ CLAUDE_API_KEY が設定されていません。');
  }

  // モデルへの指示。必ずJSONのみで返すよう明示する
  const prompt =
    'あなたはカスタマーサポートのメール分類担当です。\n' +
    '以下のメールを読み、内容を「' + CATEGORIES.join('」「') + '」のいずれか1つに分類し、\n' +
    '日本語で1〜2文の要約を作成してください。\n' +
    '出力は必ず次のJSON形式のみとし、前後に余計な文章を付けないでください。\n' +
    '{"category": "<分類>", "summary": "<要約>"}\n\n' +
    '--- 件名 ---\n' + subject + '\n\n' +
    '--- 本文 ---\n' + body;

  // リクエストボディを組み立てる
  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 512,
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // HTTPエラーでも例外を投げず、レスポンスを受け取って判定する
  };

  // APIを呼び出す
  const response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  // 2xx以外はエラーとして扱う
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Claude APIエラー (HTTP ' + statusCode + '): ' + responseText);
  }

  // レスポンスJSONを解析し、本文テキストを取り出す
  const json = JSON.parse(responseText);
  const text = (json.content && json.content[0] && json.content[0].text)
    ? json.content[0].text.trim()
    : '';

  // モデルが返したJSON文字列を解析する
  const parsed = parseClassificationJson(text);

  // 分類が想定の4種類でない場合は「その他」に丸める
  const category = CATEGORIES.indexOf(parsed.category) >= 0 ? parsed.category : 'その他';
  const summary = parsed.summary || '（要約なし）';

  return { category: category, summary: summary };
}

/**
 * モデルの出力からJSON部分を安全に取り出して解析する。
 * 余計な文字が混ざっていても { 〜 } の範囲を抽出して解析を試みる。
 *
 * @param {string} text モデルの出力テキスト
 * @return {{category: string, summary: string}}
 */
function parseClassificationJson(text) {
  // まずはそのままJSONとして解析を試みる
  try {
    return JSON.parse(text);
  } catch (e) {
    // 失敗した場合は最初の { から最後の } までを抜き出して再挑戦する
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.substring(start, end + 1));
    }
    // それでも解析できなければエラーにする
    throw new Error('Claudeの応答をJSONとして解析できませんでした: ' + text);
  }
}

/**
 * 「メールログ」シートへ1行追記する。シートが無ければ作成しヘッダーを付ける。
 *
 * @param {Date} receivedDate 受信日時
 * @param {string} sender 送信者
 * @param {string} subject 件名
 * @param {string} category 分類
 * @param {string} summary 要約
 */
function appendMailLog(receivedDate, sender, subject, category, summary) {
  const sheet = getOrCreateSheet(MAIL_LOG_SHEET_NAME,
    ['受信日時', '送信者', '件名', '分類', '要約']);
  sheet.appendRow([receivedDate, sender, subject, category, summary]);
}

/**
 * Slack Incoming Webhookで担当者へ通知する。
 *
 * @param {string} subject 件名
 * @param {string} category 分類
 * @param {string} summary 要約
 */
function notifySlack(subject, category, summary) {
  // スクリプトプロパティからWebhook URLを取得する
  const webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!webhookUrl) {
    throw new Error('スクリプトプロパティ SLACK_WEBHOOK_URL が設定されていません。');
  }

  // 通知メッセージを組み立てる（件名・分類・要約を含める）
  const messageText =
    '【新着メール: ' + category + '】\n' +
    '件名: ' + subject + '\n' +
    '要約: ' + summary;

  const payload = { text: messageText };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Slackへ送信する
  const response = UrlFetchApp.fetch(webhookUrl, options);
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Slack通知エラー (HTTP ' + statusCode + '): ' + response.getContentText());
  }
}

/**
 * エラー内容を「エラーログ」シートへ記録する。
 * ここでさらに例外が出ても処理全体を止めないよう、内部で握りつぶす。
 *
 * @param {string} context どの処理で起きたか
 * @param {Error} error 発生したエラー
 * @param {GoogleAppsScript.Gmail.GmailMessage} message 対象メール（無い場合はnull）
 */
function logError(context, error, message) {
  try {
    const sheet = getOrCreateSheet(ERROR_LOG_SHEET_NAME,
      ['発生日時', '処理', '件名', 'エラー内容']);
    const subject = message ? message.getSubject() : '';
    const detail = (error && error.stack) ? error.stack : String(error);
    sheet.appendRow([new Date(), context, subject, detail]);
  } catch (e) {
    // エラーログの記録にも失敗した場合は実行ログにだけ残す
    Logger.log('エラーログの記録に失敗しました: ' + e);
  }
}

/**
 * 指定名のシートを取得する。無ければ作成し、ヘッダー行を設定する。
 *
 * @param {string} sheetName シート名
 * @param {Array<string>} headers ヘッダー行（新規作成時のみ使用）
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold'); // ヘッダーを太字に
  }
  return sheet;
}

/**
 * 指定名のGmailラベルを取得する。無ければ作成する。
 *
 * @param {string} labelName ラベル名
 * @return {GoogleAppsScript.Gmail.GmailLabel}
 */
function getOrCreateLabel(labelName) {
  const label = GmailApp.getUserLabelByName(labelName);
  return label ? label : GmailApp.createLabel(labelName);
}

/**
 * 5分おきに classifyTodoEmails を自動実行するトリガーを登録する。
 *
 * 使い方:
 *   GASエディタでこの関数（setupEmailTrigger）を一度だけ実行する。
 *   以降は5分おきにメールの分類処理が自動で走るようになる。
 *
 * 二重登録を防ぐため、同じ関数の既存トリガーは削除してから登録し直す。
 */
function setupEmailTrigger() {
  // classifyTodoEmails に対する既存トリガーを削除する
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'classifyTodoEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 5分おきに実行する時間主導型トリガーを作成する
  ScriptApp.newTrigger('classifyTodoEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  // 確認用ログ
  Logger.log('5分おきの自動実行トリガーを登録しました。');
}
