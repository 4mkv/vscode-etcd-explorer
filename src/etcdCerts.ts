import * as vscode from 'vscode';
import * as path from 'path';
const fs = require('fs');

export class EtcdCerts {
  constructor() {
  }

  private static get_line(filename: string, line_no: number, callback: any) {
    const stream = fs.createReadStream(filename, {
      flags: 'r',
      encoding: 'utf-8',
      fd: null,
      mode: 0o666,
      bufferSize: 64 * 1024
    });
    let fileData = '';

    stream.on('data', (data: any) => {
      fileData += data;

      // The next lines should be improved
      let lines = fileData.split("\n");

      if (lines.length >= +line_no) {
        stream.destroy();
        callback(null, lines[+line_no]);
      }
    });

    stream.on('error', () => {
      callback('Error', null);
    });

    stream.on('end', () => {
      callback('File end reached without finding line', null);
    });
  }

  static hasPassPhrase(keyFile: string, callback: any) {
    EtcdCerts.get_line(keyFile, 1, (err: any, line: any) => {
      if (line.indexOf("Proc-Type:") === -1) {
        callback(false);
      } else {
        callback(true);
      }
    });
  }
}
