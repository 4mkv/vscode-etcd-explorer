import * as vscode from 'vscode';
import * as path from 'path';
import { Etcd2Explorer } from './etcd2Explorer';
import { Etcd3Explorer } from './etcd3Explorer';
var HashMap = require('hashmap');

const Etcd2 = require('node-etcd');

export class EtcdClusters {
  protected client: any;
  protected clusters = new HashMap();
  private currentCluster?: EtcdCluster;
  private etcd2View: Etcd2Explorer;
  private etcd3View: Etcd3Explorer;
  private context: vscode.ExtensionContext;
  constructor(_context: vscode.ExtensionContext, etcd2Exp: Etcd2Explorer, etcd3Exp: Etcd3Explorer) {
    this.etcd2View = etcd2Exp;
    this.etcd3View = etcd3Exp;
    this.context = _context;
    console.log("Constructing ETCD Cluster Info");

    this.initClusters();
  }

  private initClusters() {
    var currentHost: string | undefined;
    currentHost = this.context.globalState.get("etcd_current_host");

    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    var etcd_host = conf.etcd_host;
    if ((etcd_host != undefined) && (etcd_host.length > 0)) {
      this.addCluster(etcd_host, currentHost);
    }
    var context_hosts: Array<string> | undefined;
    context_hosts = this.context.workspaceState.get("etcd_hosts");
    if (context_hosts && context_hosts.length > 0) {
      for (var host of context_hosts.values()) {
        this.addCluster(host, currentHost);
      }
    }
    context_hosts = this.context.globalState.get("etcd_hosts");
    if (context_hosts && context_hosts.length > 0) {
      for (var host of context_hosts.values()) {
        this.addCluster(host, currentHost);
      }
    }
  }

  addCluster(addHost?: string, currentHost?: string) {
    var promise: Thenable<string | undefined>;
    var self = this;
    if (addHost != undefined) {
      promise = new Promise((resolve) => { resolve(addHost); });
    }
    else {
      var cancelSource = new vscode.CancellationTokenSource();
      promise = vscode.window.showInputBox({ prompt: "Etcd Cluster (Host:Port): " }, cancelSource.token);
    }
    promise.then((host) => {
      if ((host != undefined) && (host.length > 0)) {
        if (!this.hasCluster(host)) {
          var client = new Etcd2(host, { timeout: 500 });
          var description: string;
          var connection = "connecting";
          let promise = new Promise((resolve, reject) => {
            let timerId = setInterval(() => {
              if (connection == "success") {
                clearInterval(timerId);
                resolve();
              }
              if (connection == "failed") {
                clearInterval(timerId);
                reject();
              }
            }, 100);
          });
          client.raw("GET", "version", null, {}, (err: any, val: any) => {
            if (val === undefined && err) {
              console.log(require('util').inspect(err, true, 10));
              connection = "failed";
              vscode.window.showErrorMessage("Error while adding host: " +
                host +
                " (" + err.toString() +
                "). Do you wish to keep this cluster in context for later?",
                { modal: true },
                "Keep",
                "Forget").then((action) => {
                  if (action == "Keep") {
                    var context_hosts: Array<string> | undefined;
                    var hostSet: Set<string>;
                    context_hosts = this.context.globalState.get("etcd_hosts");
                    if (!context_hosts || context_hosts.length == 0) {
                      hostSet = new Set<string>();
                    }
                    else {
                      hostSet = new Set<string>(context_hosts);
                    }
                    context_hosts = Array.from(hostSet.add(host));
                    this.context.globalState.update("etcd_hosts", context_hosts);
                    self.refresh();
                  }
                  else {
                    var context_hosts: Array<string> | undefined;
                    context_hosts = this.context.globalState.get("etcd_hosts");
                    var hostSet = new Set<string>(context_hosts);
                    if (context_hosts) {
                      hostSet.delete(host);
                    }
                    context_hosts = Array.from(hostSet);
                    this.context.globalState.update("etcd_hosts", context_hosts);
                  }
                });
              return;
            }
            connection = "success";
            description = "version: " + val.etcdcluster;
          });
          promise.then(() => {
            if (!self.clusters.has(host)) {
              var cl = new EtcdCluster(host, this, description);
              self.clusters.set(host, cl);
              if (currentHost && currentHost == host) {
                if (this.currentCluster === undefined)
                  self.setCurrentCluster(cl);
              }
              if (!currentHost) {
                if (this.currentCluster === undefined)
                  self.setCurrentCluster(cl);
              }
              var context_hosts: Array<string> | undefined;
              var hostSet: Set<string>;
              context_hosts = this.context.globalState.get("etcd_hosts");
              if (!context_hosts || context_hosts.length == 0) {
                hostSet = new Set<string>();
              }
              else {
                hostSet = new Set<string>(context_hosts);
              }
              context_hosts = Array.from(hostSet.add(host));
              this.context.globalState.update("etcd_hosts", context_hosts);
              self.refresh();
            }
          }, () => {
            self.refresh();
          });
        }
      }
    });
  }

  async delCluster(cluster: EtcdCluster) {
    var clusterLabel: string | undefined;
    if (cluster === undefined) {
      var cancelSource = new vscode.CancellationTokenSource();
      clusterLabel = await vscode.window.showQuickPick(this.clusters.keys(), { placeHolder: "Select cluster" });
    }
    else {
      clusterLabel = cluster.label;
    }
    if (clusterLabel === undefined || clusterLabel.length <= 0) return;

    var prompt = vscode.window.showWarningMessage("Are you sure, you wish to delete the cluster " + clusterLabel, "Yes", "No");
    var self = this;
    prompt.then((value) => {
      if (value == "Yes") {
        self.clusters.delete(clusterLabel);

        var context_hosts: Array<string> | undefined;
        context_hosts = this.context.globalState.get("etcd_hosts");
        var hostSet = new Set<string>(context_hosts);
        if (context_hosts && clusterLabel) {
          hostSet.delete(clusterLabel);
        }
        context_hosts = Array.from(hostSet);
        this.context.globalState.update("etcd_hosts", context_hosts);

        if (self.currentCluster && self.currentCluster.label == clusterLabel) {
          self.currentCluster = undefined;
          this.context.globalState.update("etcd_current_host", undefined);
          self.etcd2View.clearView();
          self.etcd3View.clearView();
          self.etcd2View.refreshView(clusterLabel);
          self.etcd3View.refreshView(clusterLabel);
        }
        self.refresh();
      }
    });
  }

  async setCurrentCluster(cluster: EtcdCluster) {
    var clusterLabel: string | undefined;
    if (cluster === undefined) {
      var cancelSource = new vscode.CancellationTokenSource();
      clusterLabel = await vscode.window.showQuickPick(this.clusters.keys(), { placeHolder: "Select cluster" });
      cluster = this.clusters.get(clusterLabel);
    }
    if (this.currentCluster != undefined) {
      if (this.currentCluster == cluster)
        return;
      this.currentCluster.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.etcd2View.clearView();
      this.etcd3View.clearView();
    }
    this.currentCluster = cluster;
    this.currentCluster.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.currentCluster.getMembers(true);

    this.context.globalState.update("etcd_current_host", cluster.label);

    this.etcd2View.refreshView(this.currentCluster.label);
    this.etcd3View.refreshView(this.currentCluster.label);
    this.refresh();
  }

  getCurrentCluster(): string | undefined {
    return this.currentCluster?.label;
  }

  async copyName(resource: vscode.TreeItem) {
    if ((resource != undefined) && (resource.label != undefined))
      vscode.env.clipboard.writeText(resource.label);
    return;
  }

  getTreeItem(element: EtcdClusterViewItem): vscode.TreeItem {
    return (element instanceof EtcdCluster) ? element as EtcdCluster : element as EtcdClusterMember;
  }

  getChildren(element?: EtcdClusterViewItem): Thenable<EtcdClusterViewItem[]> {
    if (element != undefined) {
      return element.getMembers();
    }
    else {
      return Promise.resolve(this.clusters.values());
    }
  }

  hasCluster(name: string): boolean {
    return this.clusters.has(name);
  }

  private _onDidChangeTreeData: vscode.EventEmitter<EtcdClusterViewItem | undefined> = new vscode.EventEmitter<EtcdClusterViewItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<EtcdClusterViewItem | undefined> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshData() {
    this.clusters.clear();
    this.initClusters();
  }
}

export interface EtcdClusterViewItem {
  getMembers(): Thenable<EtcdClusterViewItem[]>;
}

export class EtcdCluster extends vscode.TreeItem implements EtcdClusterViewItem {
  private members: Array<EtcdClusterMember>;
  private leaderId?: string;
  private clustersRoot: EtcdClusters
  constructor(
    public readonly label: string,
    root: EtcdClusters,
    desc?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (desc != undefined) super.description = desc;
    this.members = new Array<EtcdClusterMember>();
    this.clustersRoot = root;
  }

  contextValue = 'etcdcluster';

  getMembers(init?: boolean): Thenable<EtcdClusterViewItem[]> {
    if (init) {
      return Promise.resolve(this.getClusterInfo());
    }
    return Promise.resolve(this.members);
  }

  hasMember(name: string): boolean {
    for (var member of this.members) {
      if (member.label === name) {
        return true;
      }
    }
    return false;
  }

  getClusterInfo(): Array<EtcdClusterMember> {
    var initializing = true;
    var client = new Etcd2([this.label]);
    var self = this;
    var selfStatsDone = false;
    client.selfStats((err: any, stats: any) => { selfStatsDone = true; self.leaderId = stats.leaderInfo.leader; });
    let promise = new Promise((resolve) => {
      let timerId = setInterval(() => {
        if (selfStatsDone) {
          clearInterval(timerId);
          resolve();
        }
      }, 100);
    });
    promise.then(() => {
      client.raw("GET", "v2/members", null, {}, (err: any, val: any) => {
        if (val === undefined) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          return;
        }
        for (var member of val.members) {
          if (!self.hasMember(member.name)) {
            if (member.id == self.leaderId) {
              self.members.push(new EtcdLeaderMember(member.name, self.clustersRoot));
            }
            else {
              self.members.push(new EtcdClusterMember(member.name, self.clustersRoot));
            }
          }
          console.log("Member: ");
          console.log(member);
        }
        initializing = false;
      });
    });

    let waitforInitialize = new Promise((resolve) => {
      let timerId = setInterval(() => {
        if (!initializing) {
          clearInterval(timerId);
          resolve();
        }
      }, 100);
    });
    waitforInitialize.then(() => {
      this.clustersRoot.refresh();
    });
    return this.members;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'cluster.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'cluster.svg')
  };
}

export class EtcdClusterMember extends vscode.TreeItem implements EtcdClusterViewItem {
  public isLeader = false;
  private clustersRoot: EtcdClusters
  constructor(
    public readonly label: string,
    root: EtcdClusters
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.clustersRoot = root;
  }

  contextValue = 'etcd_cluster_member';

  getMembers(): Thenable<EtcdClusterViewItem[]> {
    throw new Error("Method not implemented.");
  }

  iconPath = new vscode.ThemeIcon("server");
}

export class EtcdLeaderMember extends EtcdClusterMember {
  constructor(
    public readonly label: string,
    root: EtcdClusters
  ) {
    super(label, root);
    super.description = "leader";
  }
}

export class EtcdUpdatingMemberNode extends EtcdClusterMember {
  constructor(root: EtcdClusters) {
    super("Updating", root);
  }
  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'loading.gif'),
    dark: path.join(__filename, '..', '..', 'resources', 'loading.gif')
  };

}
