// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Etcd3Explorer } from './etcd3Explorer';
import { Etcd2Explorer } from './etcd2Explorer';
import { EtcdExplorerBase, EtcdNode } from './etcdExplorer';
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const etcd3Explorer = new Etcd3Explorer();
  const etcd2Explorer = new Etcd2Explorer();
  const etcd2ValueProvider = new etcdTextValueProvider(etcd2Explorer);
  const etcd3ValueProvider = new etcdTextValueProvider(etcd3Explorer);
  vscode.workspace.registerTextDocumentContentProvider(etcd2Explorer.schema(), etcd2ValueProvider);
  vscode.workspace.registerTextDocumentContentProvider(etcd3Explorer.schema(), etcd3ValueProvider);
  vscode.window.registerTreeDataProvider('etcd3view', etcd3Explorer);
  vscode.window.registerTreeDataProvider('etcd2view', etcd2Explorer);
  vscode.commands.registerCommand('etcd2view.refreshEntry', () => etcd2Explorer.refreshData());
  vscode.commands.registerCommand('etcd3view.refreshEntry', () => etcd3Explorer.refreshData());
  vscode.commands.registerCommand('etcd2view.showvalue', (resource: EtcdNode) => etcd2Explorer.openResource(resource));
  vscode.commands.registerCommand('etcd3view.showvalue', (resource: EtcdNode) => etcd3Explorer.openResource(resource));
  vscode.commands.registerCommand('etcd2view.deleteEntry', (node: EtcdNode) => etcd2Explorer.deleteResource(node));
  vscode.commands.registerCommand('etcd3view.deleteEntry', (node: EtcdNode) => etcd3Explorer.deleteResource(node));
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('etcd-manager.etcd_host')) {
      console.log("etcd-manager.etcd_host changed");
      etcd3Explorer.refreshData();
      etcd2Explorer.refreshData();
    }
  });
}

// this method is called when your extension is deactivated
export function deactivate() { }

class etcdTextValueProvider implements vscode.TextDocumentContentProvider {
  // emitter and its event
  onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.onDidChangeEmitter.event;
  private etcdExplorer: EtcdExplorerBase;
  constructor(etcdExp: EtcdExplorerBase) {
    this.etcdExplorer = etcdExp;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // simply invoke cowsay, use uri-path as text
    return this.etcdExplorer.findEtcdNodeData(uri.toString().replace(this.etcdExplorer.schema() + ":", ""));
    //return decodeURI();
  }
}