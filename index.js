#!/usr/bin/env node
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'atexovi-baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import process from 'process';
import dotenv from 'dotenv';
import express from 'express'; // Tambahkan express untuk Keep-Alive di HF
import { handler } from './src/handler.js';
import { wrapSendMessageGlobally } from './src/utils/typing.js';

dotenv.config({ debug: false });

// --- SERVER DUMMY UNTUK HUGGING FACE (PORT 7860) ---
const app = express();
app.get('/', (req, res) => res.send('Bot DownloaderX is running!'));
app.listen(7860, () => console.log(chalk.green('🌍 Server Keep-Alive running on port 7860')));

// --- LOG FILTERING (Tetap dipertahankan dari script asli) ---
const originalError = console.error;
const originalStdoutWrite = process.stdout.write;
const FILTER_PATTERNS = ['Bad MAC', 'Failed to decrypt', 'Session error:', 'Closing session:'];

process.stdout.write = function(chunk, encoding, callback) {
  const str = chunk?.toString() || '';
  if (FILTER_PATTERNS.some(p => str.includes(p))) {
    if (typeof callback === 'function') callback();
    return true;
  }
  return originalStdoutWrite.call(this, chunk, encoding, callback);
};

const authDir = path.join(process.cwd(), 'session');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir);

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false, // Matikan QR karena kita pakai Pairing
  });

  wrapSendMessageGlobally(sock);

  // --- LOGIKA PAIRING OTOMATIS ---
  // Cek apakah sudah ada file creds (sudah login atau belum)
  const isRegistered = fs.existsSync(path.join(authDir, 'creds.json'));
  
  if (!isRegistered) {
    const waNumber = "6283196580025"; 
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(waNumber);
        console.log(chalk.black.bgGreen.bold('\n KODE PAIRING WHATSAPP KAMU '));
        console.log(chalk.black.bgYellow.bold(` 📌 KODE: ${code} `));
        console.log(chalk.cyan('\nBuka WA > Perangkat Tertaut > Tautkan Perangkat > Tautkan dengan nomor telepon saja\n'));
      } catch (error) {
        console.error(chalk.red('❌ Gagal meminta pairing code:'), error);
      }
    }, 5000); // Tunggu 5 detik agar koneksi socket siap
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(chalk.greenBright('✅ Terhubung ke WhatsApp!'));
    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log(chalk.yellow('🔁 Reconnecting...'));
        startBot();
      } else {
        console.log(chalk.red('❌ Session Logout. Hapus folder session/ di Space kamu.'));
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg || msg.key.fromMe) return;
    try {
      await handler(sock, msg);
    } catch (err) {
      console.error(chalk.red('[Handler Error]'), err);
    }
  });
}

startBot();
                    
