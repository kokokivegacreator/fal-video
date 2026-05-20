const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1Fkwj6CNZVympggBCMEFRbCuvQMXprPLdxQjh7n3WGOI';

let sheetsClient = null;

function init() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json';
  const resolvedPath = path.resolve(keyPath);

  if (!fs.existsSync(resolvedPath)) {
    console.warn('[Sheets] service-account.json not found — Sheets feature disabled');
    return;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  console.log('[Sheets] Google Sheets client initialized');
}

// Returns [{name, link, rowIndex}] from first sheet columns A & B (skips header row 1)
async function getChannels() {
  if (!sheetsClient) {
    throw new Error('Google Sheets not configured — add service-account.json and GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  }

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A:B',
  });

  const rows = response.data.values || [];
  const channels = [];

  // Row index 0 = header (row 1 in sheet), start from index 1 (row 2 in sheet)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] || '').trim();
    const link = (row[1] || '').trim();
    if (name) {
      channels.push({ name, link, rowIndex: i + 1 }); // rowIndex is 1-based sheet row
    }
  }

  return channels;
}

// Returns {data: {d, e, f}, answerChat: {e}} for the given 1-based sheet rowIndex
async function getChannelData(rowIndex) {
  if (!sheetsClient) {
    throw new Error('Google Sheets not configured — add service-account.json and GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  }

  const row = Number(rowIndex);
  if (!row || row < 2) {
    throw new Error('Invalid rowIndex — must be a number >= 2');
  }

  const [dataRes, answerRes] = await Promise.all([
    sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Data!D${row}:F${row}`,
    }),
    sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `answer_chat!E${row}:E${row}`,
    }),
  ]);

  const dataRow = (dataRes.data.values || [[]])[0] || [];
  const answerRow = (answerRes.data.values || [[]])[0] || [];

  return {
    data: {
      d: dataRow[0] || '',
      e: dataRow[1] || '',
      f: dataRow[2] || '',
    },
    answerChat: {
      e: answerRow[0] || '',
    },
  };
}

module.exports = { init, getChannels, getChannelData };
