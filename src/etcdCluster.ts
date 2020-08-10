import * as vscode from 'vscode';
import * as path from 'path';
import { Etcd2Explorer } from './etcd2Explorer';
import { Etcd3Explorer } from './etcd3Explorer';
import { URL } from 'url';
import { EtcdCerts } from './etcdCerts';

var fs = require('fs');
var HashMap = require('hashmap');

const Etcd2 = require('node-etcd');

export class EtcdClusters {
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

    // depricate setting
    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    if ((conf.etcd_host != undefined) && (conf.etcd_host.length > 0)) {
      this.addCluster(conf.etcd_host, currentHost);
    }

    // depricate workspace state -> move to global state
    var context_hosts: Array<string> | undefined;
    context_hosts = this.context.workspaceState.get("etcd_hosts");
    if (context_hosts && context_hosts.length > 0) {
      for (var host of context_hosts.values()) {
        this.addCluster(host, currentHost);
      }
    }
    this.context.workspaceState.update("etcd_hosts", undefined);

    // use global state
    context_hosts = this.context.globalState.get("etcd_hosts");
    if (context_hosts && context_hosts.length > 0) {
      for (var host of context_hosts.values()) {
        this.addCluster(host, currentHost);
      }
    }
  }

  get_cert_file_path(cert_path: string, cert_name: string, isKey: boolean): string {
    // make sure files exist else check for pem files

    var file = path.join(cert_path, cert_name + (isKey ? ".key" : ".crt"));
    if (!fs.existsSync(file)) {
      file = path.join(cert_path, (isKey ? "etcd-key" : cert_name) + ".pem");
      if (!fs.existsSync(file)) {
        return "";
      }
    }
    return file;
  }

  async addClientCerts(cluster: EtcdCluster, cert_path?: string) {
    var self = this;
    if (cluster && cluster.label) {
      await this.addCertsOptions(cluster.label, (certOptions: any) => {
        cluster.setOptions(certOptions);
      }, cert_path);
      let promise = self.getVersionInfo(cluster.label, cluster.options);
      await promise.then((versionInfo: any) => {
        cluster.setContextValue(versionInfo.clusterContext);
        if (cluster.contextValue == "etcdclustertlsauth") {
          cluster.tlsauth = true;
        }
        cluster.setTooltip(versionInfo.tooltip);
        cluster.description = versionInfo.description;
      });
      self.refresh();
    }
  }

  async addCertsOptions(hostString: string, setOptions: any, cert_path?: string) {
    var hostString: string;
    var self = this;
    var options = {
      timeout: 1000,
      ca: "",
      cert: "",
      key: "",
      passphrase: "",
      auth: undefined
    }
    var url = new URL(hostString);
    var protocol = url.protocol;
    var host = url.host;
    if (protocol.toLowerCase() != "https:") {
      vscode.window.showErrorMessage("The server endpoint protocol must be https");
    }
    if (!cert_path) {
      await vscode.window.showOpenDialog({
        openLabel: "Select Certificates Path for " + hostString,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        //filters: { "CA Certificate File": ["pem", "crt"] }
      }).then(async (certsPath) => {
        if (certsPath) {
          cert_path = certsPath[0].path;
        }
      }, async () => { });
    }
    if (cert_path) {
      this.context.globalState.update(hostString + "_certs_path", cert_path);
      //options.ca = fs.readFileSync(self.get_cert_file_path(cert_path, "ca", false));
      var conf = vscode.workspace.getConfiguration('etcd-explorer');
      if (conf.root_ca_path) {
        options.ca = fs.readFileSync(conf.root_ca_path);
      }
      options.cert = fs.readFileSync(self.get_cert_file_path(cert_path, "client", false));
      options.key = fs.readFileSync(self.get_cert_file_path(cert_path, "client", true));
    }
    if (options.key.length > 0) {
      await EtcdCerts.hasPassPhrase(options.key, async (hasPP: boolean) => {
        if (hasPP && cert_path) {
          await vscode.window.showInputBox({
            password: true,
            prompt: "Pass Phrase for the Key file " + self.get_cert_file_path(cert_path, "etcd-client", true)
          }).then((pwd) => {
            if (pwd)
              options.passphrase = pwd;
          });
        }
      })
    }
    setOptions(options);
  }

  addCluster(addHost?: string, currentHost?: string) {
    var promise: Thenable<string | undefined>;
    var self = this;
    if (addHost != undefined) {
      promise = new Promise((resolve) => { resolve(addHost); });
    }
    else {
      promise = new Promise((resolve) => {
        var inputBox = vscode.window.createInputBox();
        inputBox.title = "Etcd Cluster (Protocol(http/https)://Host:Port): ";
        inputBox.prompt = "e.g. https://locathost:2379 or http://xxx.xxx.xxx.xxx:2379";
        inputBox.onDidAccept(() => {
          resolve(inputBox.value);
          inputBox.dispose();
        });
        inputBox.show();
      });
    }
    promise.then(async (value) => {
      var hostString = "";
      if ((value != undefined) && (value.length > 0)) {
        hostString = value;
        if (!this.hasCluster(hostString)) {
          if (!hostString.toLowerCase().startsWith("http")) {
            hostString = "http://" + hostString; // default to http
          }
          var options = {
            timeout: 1000,
            ca: "",
            cert: "",
            key: "",
            passphrase: "",
            auth: undefined
          }
          console.log("Ready to create ETCD2 Client");

          var url = new URL(hostString);
          var protocol = url.protocol;
          if (protocol.toLowerCase() == "https:") {
            var conf = vscode.workspace.getConfiguration('etcd-explorer');
            if (conf.root_ca_path) {
              options.ca = fs.readFileSync(conf.root_ca_path);
            }
          }
          let promise = self.getVersionInfo(hostString, options);
          promise.then((versionInfo: any) => {
            if (!self.clusters.has(hostString)) {
              var cl = new EtcdCluster(hostString, self, versionInfo.clusterContext, options, versionInfo.description, versionInfo.tooltip);
              self.clusters.set(hostString, cl);
              if (currentHost && currentHost == hostString) {
                if (self.currentCluster === undefined)
                  self.setCurrentCluster(cl);
              }
              if (!currentHost) {
                if (self.currentCluster === undefined)
                  self.setCurrentCluster(cl);
              }
              self.addHostToContext(hostString);
              self.refresh();
            }
          }, () => {
            self.refresh();
          });
        }
      }
    });
  }

  private addHostToContext(hostString: string) {
    var context_hosts: Array<string> | undefined;
    var hostSet: Set<string>;
    context_hosts = this.context.globalState.get("etcd_hosts");
    if (!context_hosts || context_hosts.length == 0) {
      hostSet = new Set<string>();
    }
    else {
      hostSet = new Set<string>(context_hosts);
    }
    context_hosts = Array.from(hostSet.add(hostString));
    this.context.globalState.update("etcd_hosts", context_hosts);
  }

  private handleFailedConnection(hostString: string, err: any) {
    var self = this;
    var url = new URL(hostString);
    var protocol = url.protocol;
    var host = url.host;
    var errmsg = err.message;
    if (err.errors && err.errors.length > 0 && err.errors[0].httperror) {
      errmsg = err.errors[0].httperror.message;
    }
    vscode.window.showErrorMessage("Error while adding host: " +
      hostString +
      " (" + errmsg +
      "). Do you wish to keep this cluster in context for later?",
      { modal: true },
      "Keep",
      "Forget"
    ).then((action) => {
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
        context_hosts = Array.from(hostSet.add(hostString));
        this.context.globalState.update("etcd_hosts", context_hosts);
        self.refresh();
      }
      else {
        var context_hosts: Array<string> | undefined;
        context_hosts = this.context.globalState.get("etcd_hosts");
        var hostSet = new Set<string>(context_hosts);
        if (context_hosts) {
          if (protocol.toLowerCase() != "https:") {
            hostSet.delete(host);
          }
          hostSet.delete(hostString);
        }
        context_hosts = Array.from(hostSet);
        this.context.globalState.update("etcd_hosts", context_hosts);
      }
    });
  }

  async getVersionInfo(hostString: string, options: any) {
    var self = this;
    var client = new Etcd2(hostString, options);
    var connection = "connecting";
    var versionInfo = {
      description: "",
      tooltip: hostString,
      clusterContext: "etcdcluster"
    }
    if (options.cert && options.cert.length > 0) {
      versionInfo.clusterContext = "etcdclustertlsauth";
    }

    let promise = new Promise((resolve, reject) => {
      let timerId = setInterval(() => {
        if (connection == "success") {
          clearInterval(timerId);
          resolve(versionInfo);
        }
        if (connection == "failed") {
          clearInterval(timerId);
          reject("Connection Failed");
        }
      }, 100);
    });
    console.log("Ready to get ETCD2 Client version");
    client.raw("GET", "version", null, options, (err: any, val: any) => {
      if ((val === undefined && err) || (typeof val == "string")) {
        if (typeof val == "string") err = val;
        if (typeof err != "string") {
          if (err.errors.length > 0) {
            if ((err.errors[0].httperror.message.includes("OPENSSL")) && (err.errors[0].httperror.message.includes("SSLV3_ALERT_BAD_CERTIFICATE"))) {
              connection = "success";
              versionInfo.description = "Client Certificate Error ...";
              versionInfo.tooltip = "Server requires a client certificate for access. Please select path that contains valid client certificate and key. (Use context menu)"
              versionInfo.clusterContext = "etcdclusterincerterr";
              return;
            }
          }
        }
        console.log(require('util').inspect(err, true, 10));
        connection = "failed";
        self.handleFailedConnection(hostString, err);
        return;
      }
      connection = "success";
      versionInfo.description = "version: " + val.etcdcluster;
      return;
    });
    return promise;
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
        this.context.globalState.update(clusterLabel + "_certs_path", undefined);

        if (self.currentCluster && self.currentCluster.label == clusterLabel) {
          self.currentCluster = undefined;
          this.context.globalState.update("etcd_current_host", undefined);
          self.etcd2View.clearView();
          self.etcd3View.clearView();
          if (self.clusters.size > 0) {
            //select first available cluster
            //var current_cluster: EtcdCluster = self.clusters.get(self.clusters.keys[0]);
            //self.etcd2View.refreshView(current_cluster.label, current_cluster.options);
            //self.etcd3View.refreshView(current_cluster.label, current_cluster.options);
          }
        }
        self.refresh();
      }
    });
  }

  async setCurrentCluster(cluster: EtcdCluster) {
    var clusterLabel: string | undefined;
    if (cluster === undefined) {
      clusterLabel = await vscode.window.showQuickPick(this.clusters.keys(), { placeHolder: "Select cluster" });
      cluster = this.clusters.get(clusterLabel);
    }
    if (cluster.contextValue == "etcdclusterincerterr") {
      return;
    }
    if (this.currentCluster != undefined) {
      if (this.currentCluster == cluster)
        return;
      this.currentCluster.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.currentCluster.setContextValue("etcdcluster")
      if (this.currentCluster.tlsauth) {
        this.currentCluster.setContextValue("etcdclustertlsauth");
      }
      this.etcd2View.clearView();
      this.etcd3View.clearView();
    }
    this.currentCluster = cluster;
    this.currentCluster.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.currentCluster.getMembers(true);

    this.context.globalState.update("etcd_current_host", cluster.label);
    cluster.setContextValue("etcdclustercurrent");
    vscode.commands.executeCommand('setContext', 'etcdcluster.currentcluster', true);
    if (cluster.tlsauth) {
      cluster.setContextValue("etcdclustertlsauthcurrent");
      vscode.commands.executeCommand('setContext', 'etcdcluster.tlsauth', true);
    }

    this.etcd2View.refreshView(this.currentCluster.label, this.currentCluster.options);
    this.etcd3View.refreshView(this.currentCluster.label, this.currentCluster.options);
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
    vscode.commands.executeCommand('setContext', 'etcdcluster.currentcluster', false);
    this.currentCluster == undefined;
    this.etcd2View.clearView();
    this.etcd3View.clearView();
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
  public options: any;
  public tlsauth = false;
  constructor(
    public readonly label: string,
    root: EtcdClusters,
    context: string,
    options?: any,
    desc?: string,
    tip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (desc != undefined) super.description = desc;
    super.tooltip = label
    if (tip) super.tooltip = tip + " : " + context;
    super.contextValue = context
    this.members = new Array<EtcdClusterMember>();
    this.clustersRoot = root;
    this.options = options;
  }

  setContextValue(ctx: string) {
    this.contextValue = ctx;
    //this.tooltip += " : " + ctx;
  }

  setTooltip(tip: string) {
    this.tooltip = tip;
    //this.tooltip += " : " + this.contextValue;
  }

  setOptions(certOptions: any) {
    this.options = certOptions;
  }

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
    var client = new Etcd2(this.label, this.options);
    var self = this;
    var selfStatsDone = false;
    client.selfStats((err: any, stats: any) => {
      selfStatsDone = true;
      if (stats === undefined && err) {
        console.log(require('util').inspect(err, true, 10));
        vscode.window.showErrorMessage(err.toString());
        return;
      }
      if ((typeof stats == "string") || (stats instanceof String)) {
        err = stats;
        console.log(require('util').inspect(err, true, 10));
        vscode.window.showErrorMessage(err.toString());
        return;
      }
      self.leaderId = stats.leaderInfo.leader;
    });
    let promise = new Promise((resolve) => {
      let timerId = setInterval(() => {
        if (selfStatsDone) {
          clearInterval(timerId);
          resolve();
        }
      }, 100);
    });
    promise.then(() => {
      client.raw("GET", "v2/members", null, self.options, (err: any, val: any) => {
        if (val === undefined && err) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          return;
        }
        if ((typeof val == "string") || (val instanceof String)) {
          err = val;
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
