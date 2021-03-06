// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
process.env.GRPC_TRACE = 'all';
process.env.GRPC_VERBOSITY = 'DEBUG';
//process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { EtcdClusters, EtcdCluster, EtcdClusterViewItem } from './etcdCluster';
import { Etcd3Explorer } from './etcd3Explorer';
import { Etcd2Explorer } from './etcd2Explorer';
import { EtcdExplorerBase, EtcdNode } from './etcdExplorer';
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("Initializing etcd-explorer");
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const etcd3Explorer = new Etcd3Explorer(context);
  const etcd2Explorer = new Etcd2Explorer(context);
  const etcdClusters = new EtcdClusters(context, etcd2Explorer, etcd3Explorer);
  const etcd2ValueProvider = new etcdTextValueProvider(etcd2Explorer);
  const etcd3ValueProvider = new etcdTextValueProvider(etcd3Explorer);
  vscode.workspace.registerTextDocumentContentProvider(etcd2Explorer.schema(), etcd2ValueProvider);
  vscode.workspace.registerTextDocumentContentProvider(etcd3Explorer.schema(), etcd3ValueProvider);
  vscode.window.registerTreeDataProvider('etcdclusterview', etcdClusters);
  //vscode.window.registerTreeDataProvider('etcd3view', etcd3Explorer);
  //vscode.window.registerTreeDataProvider('etcd2view', etcd2Explorer);
  var treeView3 = vscode.window.createTreeView('etcd3view', {
    treeDataProvider: etcd3Explorer
  });
  var treeView2 = vscode.window.createTreeView('etcd2view', {
    treeDataProvider: etcd2Explorer
  });
  etcd3Explorer.setTreeView(treeView3);
  etcd2Explorer.setTreeView(treeView2);
  treeView2.onDidChangeVisibility((val: any) => {
    etcd2Explorer.visibilityChanged(val.visible);
  });
  treeView3.onDidChangeVisibility((val: any) => {
    etcd3Explorer.visibilityChanged(val.visible);
  });

  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.addClientCerts', (resource: EtcdCluster) => etcdClusters.addClientCerts(resource));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.enableAuth', () => etcd2Explorer.enableAuth());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.enableAuth', () => etcd3Explorer.enableAuth());
  vscode.commands.registerCommand('etcd-explorer.etcd2view.disableAuth', () => etcd2Explorer.disableAuth());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.disableAuth', () => etcd3Explorer.disableAuth());
  vscode.commands.registerCommand('etcd-explorer.etcd2view.login', () => etcd2Explorer.login());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.login', () => etcd3Explorer.login());
  vscode.commands.registerCommand('etcd-explorer.etcd2view.logout', () => etcd2Explorer.logout());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.logout', () => etcd3Explorer.logout());
  vscode.commands.registerCommand('etcd-explorer.etcd2view.refreshEntry', () => etcd2Explorer.refreshData());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.refreshEntry', () => etcd3Explorer.refreshData());
  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.refreshEntry', () => etcdClusters.refreshData());
  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.addCluster', (host) => etcdClusters.addCluster(host));
  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.delCluster', (cluster) => etcdClusters.delCluster(cluster));
  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.setCurrentCluster', (resource: EtcdCluster) => etcdClusters.setCurrentCluster(resource));
  vscode.commands.registerCommand('etcd-explorer.etcdclusterview.copyName', (resource: vscode.TreeItem) => etcdClusters.copyName(resource));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.showvalue', (resource: EtcdNode) => etcd2Explorer.openResource(resource));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.showvalue', (resource: EtcdNode) => etcd3Explorer.openResource(resource));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.deleteEntry', (node: EtcdNode) => etcd2Explorer.deleteResource(node));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.deleteEntry', (node: EtcdNode) => etcd3Explorer.deleteResource(node));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.fromJSON', (node?: EtcdNode) => etcd3Explorer.importResource());
  vscode.commands.registerCommand('etcd-explorer.etcd2view.fromJSON', (node?: EtcdNode) => etcd2Explorer.importResource());
  vscode.commands.registerCommand('etcd-explorer.etcd3view.toJSON', (node?: EtcdNode) => etcd3Explorer.exportResource(node));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.toJSON', (node?: EtcdNode) => etcd2Explorer.exportResource(node));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.copyPath', (node?: EtcdNode) => etcd3Explorer.copyResourcePrefix(node));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.copyPath', (node?: EtcdNode) => etcd2Explorer.copyResourcePrefix(node));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.copyName', (node?: EtcdNode) => etcd3Explorer.copyResourceName(node));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.copyName', (node?: EtcdNode) => etcd2Explorer.copyResourceName(node));
  vscode.commands.registerCommand('etcd-explorer.etcd3view.addKV', (node?: EtcdNode) => etcd3Explorer.addKeyValue(node));
  vscode.commands.registerCommand('etcd-explorer.etcd2view.addKV', (node?: EtcdNode) => etcd2Explorer.addKeyValue(node));

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('etcd-explorer.etcd_host')) {
      console.log("etcd-explorer.etcd_host changed");
      etcdClusters.refreshData();
      etcd3Explorer.refreshData();
      etcd2Explorer.refreshData();
    }
  });

}

// this method is called when your extension is deactivated
export function deactivate() { }

class etcdTextValueProvider implements vscode.TextDocumentContentProvider {
  // emitter and its event
  _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  get onDidChange() {
    return this._onDidChange.event;
  }

  private etcdExplorer: EtcdExplorerBase;
  constructor(etcdExp: EtcdExplorerBase) {
    this.etcdExplorer = etcdExp;
    this.etcdExplorer.setDocumentChangedEventEmitter(this._onDidChange);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // simply invoke cowsay, use uri-path as text
    var data: string | undefined;
    var error: string;
    var uriPath = uri.fsPath;
    var node = this.etcdExplorer.findEtcdNode(uriPath);
    if (!node) {
      error = "Key not found: " + uriPath;
    }
    else
      data = node.getData();

    error = data ? "" : "No Value found for " + uriPath;
    if (error && !data) {
      vscode.window.showErrorMessage(error);
    }
    return (data) ? data : "";
    //return decodeURI();
  }
}