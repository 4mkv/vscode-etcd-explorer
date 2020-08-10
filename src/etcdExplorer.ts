import * as vscode from 'vscode';
import * as path from 'path';
import { URL } from 'url';

var HashMap = require('hashmap');

var separator = "/";

export class EtcdExplorerBase {
  private etcdSch = "";
  private rootNode: EtcdRootNode;
  protected etcd_host?: string;
  protected protocol?: string;
  protected host_options?: any;
  protected authentication?: { username?: string, password?: string, cn?: string, roles?: string[] };
  protected client: any;
  protected conflictsResolution = "abort";
  protected sameKeysResolution = "abort";
  protected arrayResolution = "Array as string";
  protected authEnabled = false;
  protected isVisible = false;
  private context: vscode.ExtensionContext;
  protected _treeView: vscode.TreeView<EtcdNode> | undefined;
  protected documentChanged?: vscode.EventEmitter<vscode.Uri>;
  constructor(schema: string, _context: vscode.ExtensionContext) {
    console.log("Constructing ETCD Explorer");
    this.context = _context;
    this.etcdSch = schema;
    this.reloadConfig();
    this.rootNode = new EtcdRootNode(this);
  }

  async visibilityChanged(visible: boolean) {
    this.isVisible = visible;
    /*    if (!visible) {
          this.clearView();
        }
        else {
          if (this.etcd_host) {
            this.refreshView(this.etcd_host);
          }
        }
        */
  }

  setHost(etcdhostString?: string) {
    if (etcdhostString) {
      this.etcd_host = etcdhostString;
      var url = new URL(etcdhostString);
      this.protocol = url.protocol;
    }
    else {
      this.etcd_host = undefined;
      this.protocol = undefined;
    }
  }

  protected setTreeViewTitleUser(user?: string, roles?: string[], cn?: string) {
    if (this._treeView && this.authEnabled) {
      if (cn) {
        this._treeView.message = "Client Certificate CN: " + cn;
      }
      else {
        if (!user) {
          this._treeView.message = "user [roles]: [guest]";
        }
        else {
          this._treeView.message = "user [roles]: " + user + ((roles === undefined) ? "" : (" [" + roles.toString() + "]"));
        }
      }
    }
    if (this._treeView && !this.authEnabled) {
      this._treeView.message = "";
    }
  }

  setTreeView(tv: vscode.TreeView<EtcdNode>) {
    this._treeView = tv;
    if (this.authentication) {
      this.setTreeViewTitleUser(this.authentication.username, this.authentication.roles);
    }
    else {
      this.setTreeViewTitleUser();
    }
  }

  async isAuthEnabled() { }

  async enableAuth() {
    // check if auth is enabled
    // else enable it
  }

  async disableAuth() {

  }

  protected reloadConfig() {
    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    var importJSON = conf.importJSON;
    this.conflictsResolution = importJSON.conflicts;
    this.sameKeysResolution = importJSON.sameKeys;
    this.arrayResolution = importJSON.arrays;
  }

  protected getConfig() {
    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    return conf;
  }

  setDocumentChangedEventEmitter(_documentChanged?: vscode.EventEmitter<vscode.Uri>) {
    this.documentChanged = _documentChanged;
  }

  refreshDocument(uri: vscode.Uri) {
    this.documentChanged?.fire(uri);
  }

  public RootNode(): EtcdRootNode {
    return this.rootNode;
  }

  schema(): string {
    return this.etcdSch;
  }

  protected resetContextValues() {
  }

  clearView() {
    this.resetContextValues();
    this.authEnabled = false;
    this.setTreeViewTitleUser();
    this.RootNode().getChildren().clearChildren();
    this.setHost(undefined);
    this.refresh();
  }

  refreshView(clusterHost: string, options?: any) {
    if (!this.isVisible) return;

    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    var importJSON = conf.importJSON;
    this.conflictsResolution = importJSON.conflicts;
    this.sameKeysResolution = importJSON.sameKeys;
    this.arrayResolution = importJSON.arrays;

    if (clusterHost != this.etcd_host) {
      this.setHost(clusterHost);
      if (options) {
        this.host_options = options;
      }
      this.refreshData();
    }
    this.isAuthEnabled();
  }

  getChildren(element?: EtcdNode): Thenable<EtcdNode[]> {
    element = element ? element : this.rootNode;
    var children = element.getChildren();
    if (children.isUpdating()) {
      var arrayChildren = children.toArray();
      if (children.getNodeByLabel("loading").leaf === undefined)
        arrayChildren.push(new EtcdUpdatingNode(this, element));
      return Promise.resolve(arrayChildren);
    }
    children.removeUpdatingNodes();
    if (this.rootNode.getChildren(true).toArray().length == 0) {
      return Promise.resolve([new EtcdEmptyWSNode(this, this.rootNode)]);
    }
    return Promise.resolve(element.getChildren().toArray());
  }

  async loginas(user: string, pwd: string) {
  }

  async login() {
    var self = this;
    self.basicLogin();
    /*vscode.window.showQuickPick(["Basic Authentication", "TLS Certificates"]).then((selection) => {
      if (selection === undefined) return;
      if (selection == "Basic Authentication") {
        self.basicLogin();
      }
      else {
        self.tlsLogin();
      }
    });
    */
  }

  async tlsLogin() {
    vscode.window.showOpenDialog({
      openLabel: "Open CA Certificate File",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Certificate Files": ["pem"] }
    }).then((caFile) => {
      if (caFile) {
        vscode.window.showOpenDialog({
          openLabel: "Open Client Certificate File",
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "Certificate Files": ["pem"] }
        }).then((clientFile) => {
          if (clientFile) {
            vscode.window.showOpenDialog({
              openLabel: "Open Key File",
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              filters: { "Key Files": ["pem"] }
            }).then((keyFile) => {
              if (keyFile) {

              }
            });
          }
        });
      }
    });
  }

  async basicLogin() {
    var userBox = vscode.window.createInputBox();
    userBox.title = "Login as user";
    var self = this;
    userBox.onDidAccept(async () => {
      var pwdBox = vscode.window.createInputBox();
      pwdBox.title = "Password";
      pwdBox.password = true;
      pwdBox.onDidAccept(async () => {
        var pwd = pwdBox.value;
        var user = userBox.value;
        await self.loginas(user, pwd);
        pwdBox.dispose();
        userBox.dispose();
      });
      pwdBox.show();
    });
    userBox.show();
  }

  async logout() {
    var hostString = this.etcd_host;
    var protocol = this.protocol;
    if (this.client.close) {
      this.client.close();
    }
    this.client = undefined;
    this.authentication = undefined;
    this.host_options.auth = undefined;
    this.clearView();

    this.etcd_host = hostString;
    this.protocol = protocol;

    if (this.etcd_host) {
      this.initClient();
      this.refreshView(this.etcd_host);
    }
  }

  protected async write(key: string, value: any) { return new Promise((resolve, reject) => { reject("Not Implemented in base class"); }); }

  // used by importJSON and addKeyValue
  async jsonToEtcd(jsonObj: JSON, token?: vscode.CancellationToken) {
    if (this.client === undefined) return;
    var currentKey = "";
    var writes = new Array<{ value: string, key: string }>();
    var conflicts = new Array<{ value: string, key: string, srcLeaf: boolean, dstLeaf: boolean }>();
    this.reloadConfig();
    // using stack to recurse through JSON object
    var stack = new Array<{ json: JSON, key: string }>();
    stack.push({ json: jsonObj, key: currentKey });
    while (stack.length > 0) {
      if (token && token.isCancellationRequested) return;
      var obj = stack.pop();
      if (!obj) break;
      var json = obj.json;
      var entries = Object.entries(json);
      for (var entry of entries) {
        if (token && token.isCancellationRequested) return;
        currentKey = obj.key;
        var isLeaf = false;
        var key = entry[0];
        var value = entry[1];
        isLeaf = this.isValueType(value);
        currentKey += key.startsWith(separator) ? key : (separator + key);
        var existingNode = this.findEtcdNode(currentKey);
        if (!existingNode) {
          existingNode = this.findEtcdNode(currentKey + separator);
        }
        if (!isLeaf) {  /*json key is not leaf but dir*/
          if (existingNode && existingNode.isLeafNode()) { /* existing node is not dir but leaf*/
            // this is allowed in etcd3 but not in etcd2 
            // etcd3 can have cases like: /a/b = c && /a = e
            if (this.schema().startsWith('etcd2')) {
              conflicts.push({ key: currentKey, value: value, srcLeaf: isLeaf, dstLeaf: existingNode.isLeafNode() });
            }
          }
          stack.push({ json: value, key: currentKey });
        }
        else { /*json key is leaf */
          if (existingNode) {
            conflicts.push({ key: currentKey, value: value, srcLeaf: isLeaf, dstLeaf: existingNode.isLeafNode() });
          }
          else {
            if (this.getType(value) == "array") {
              this.reloadConfig();
              if (this.arrayResolution == "Array as string") {
                value = JSON.stringify(value);
                writes.push({ key: currentKey, value: value });
              }
              else {
                var index = 0;
                for (var val of value) {
                  var valObj = Object.create({});
                  valObj["[" + index + "]"] = val;
                  index++;
                  stack.push({ key: currentKey, json: valObj });
                }
              }
            }
            else {
              writes.push({ key: currentKey, value: value });
            }
          }
        }
      }
    }
    if (conflicts.length > 0) {
      var conflictStr = "";
      var abortImport = false;
      for (var conflict of conflicts) {
        conflictStr = "Conflicts:\n ==================================\n";
        if (conflict.srcLeaf && !conflict.dstLeaf) {
          conflictStr += ">>>>Existing key is not a folder\n" + conflict.key + ": " + conflict.value + "\n";
          if (this.conflictsResolution == "abort") abortImport = true;
          if (this.conflictsResolution == "overwrite") {
            var response: string | undefined;
            var noOwPromptCR = this.context.globalState.get("no_overwrite_prompt_for_conflicting_keys");
            if (!noOwPromptCR) {
              await vscode.window.showWarningMessage("Etcd Explorer: You have chosen to overwrite the values for same keys in settings, do you wish to continue?", { "modal": true }, "Yes, and don't ask again", "Yes").then((s) => { response = s; });
              if (response === undefined) abortImport = true;
              else if (response != "Yes") {
                this.context.globalState.update("no_overwrite_prompt_for_conflicting_keys", true);
              }
            }
          }
        }
        else if (!conflict.srcLeaf && conflict.dstLeaf) {
          conflictStr += ">>>>Existing key is not a file\n" + conflict.key + ": " + conflict.value + "\n";
          if (this.conflictsResolution == "abort") abortImport = true;
          if (this.sameKeysResolution == "overwrite") {
            var response: string | undefined;
            var noOwPromptCR = this.context.globalState.get("no_overwrite_prompt_for_conflicting_keys");
            if (!noOwPromptCR) {
              await vscode.window.showWarningMessage("Etcd Explorer: You have chosen to overwrite the values for same keys in settings, do you wish to continue?", { "modal": true }, "Yes, and don't ask again", "Yes").then((s) => { response = s; });
              if (response === undefined) abortImport = true;
              else if (response != "Yes") {
                this.context.globalState.update("no_overwrite_prompt_for_conflicting_keys", true);
              }
            }
          }
        }
        else {
          conflictStr += ">>>>Key already exists\n" + conflict.key + ": " + conflict.value + "\n";
          if (this.sameKeysResolution == "abort") abortImport = true;
          if (this.sameKeysResolution == "overwrite") {
            var response: string | undefined;
            var noOwPromptSK = this.context.globalState.get("no_overwrite_prompt_for_same_keys");
            if (!noOwPromptSK) {
              await vscode.window.showWarningMessage("Etcd Explorer: You have chosen to overwrite the values for same keys in settings, do you wish to continue?", { "modal": true }, "Yes, and don't ask again", "Yes").then((s) => { response = s; });
              if (response === undefined) abortImport = true;
              else if (response != "Yes") {
                this.context.globalState.update("no_overwrite_prompt_for_same_keys", true);
              }
            }
          }
        }
        if (abortImport)
          continue;
        if (conflict.srcLeaf != conflict.dstLeaf) {
          if (this.conflictsResolution == "ignore")
            continue;
          if (this.conflictsResolution == "overwrite") {
            // showWarningMessage
            if (!conflict.srcLeaf) {
              var n = this.findEtcdNode(conflict.key.replace(new RegExp(separator + '*$'), ""));
              if (n) {
                var parent = n.Parent();
                this.deleteKeys(n.prefix).then(() => {
                  if (parent) {
                    parent.getChildren().removeNode(n);
                    parent.refreshChildren = true;
                  }
                }).catch(() => { });
              }
            }
            else
              writes.push({ key: conflict.key, value: conflict.value });
          }
        }
        else {
          if (this.sameKeysResolution == "ignore")
            continue;
          if (this.sameKeysResolution == "overwrite")
            writes.push({ key: conflict.key, value: conflict.value });
        }
      }
      if (abortImport) {
        let doc = await vscode.workspace.openTextDocument({ content: conflictStr, language: "json" });
        vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showErrorMessage("Aborting json import due to conflict with existing keys");
        return;
      }
    }
    if (token && token.isCancellationRequested) return;
    for (var write of writes) {
      if (token && token.isCancellationRequested) return;
      var n = this.findEtcdNode(write.key);
      if (n) {
        var parent = n.Parent();
        if (parent) {
          console.log("Removing node: " + n.prefix);
          parent.getChildren().removeNode(n);
          parent.refreshChildren = true;
        }
      }
      await this.deleteKeys(write.key).then(() => { }).catch((reason) => { });
      await this.write(write.key, write.value).then(() => { }).catch((reason) => {
        vscode.window.showErrorMessage("Error: while writing key " + write.key + " [" + reason + "]");
      });
    }
  }

  protected isValueType(value: any): boolean {
    var str = Object.prototype.toString.call(value);
    var type = str.slice(8, -1).toLowerCase();
    var isValType = false;
    if (type == "string"
      || type == "boolean"
      || type == "number"
      || type == "date"
      || type == "array"
      || type == "undefined"
      || type == "null") {
      isValType = true;
    }
    else {
      isValType = false;
    }

    return isValType;
  }

  protected getType(value: any): string {
    var str = Object.prototype.toString.call(value);
    var type = str.slice(8, -1).toLowerCase();
    return type;
  }

  async jsonToLevelNodeList(jsonObj: JSON, node: EtcdNode, explorer: EtcdExplorerBase) {

    // use stack to iterate DFS 
    var stack = Array<{ json: JSON, node: EtcdNode }>();
    stack.push({ json: jsonObj, node: node });
    var staleMap = new HashMap();
    while (stack.length > 0) {
      var obj = stack.pop();
      if (!obj) break;
      var entries = Object.entries(obj.json);
      var nodeList = obj.node.getChildren();
      for (var chNode of nodeList.toArray()) {
        if (!staleMap.has(chNode.prefix)) {
          chNode.stale = true;
          staleMap[chNode.prefix] = chNode;
        }
      }
      for (var entry of entries) {
        var isLeaf = false;
        var key = entry[0];
        var value = entry[1];
        isLeaf = explorer.isValueType(value);
        var existingNodes = nodeList.getNodeByLabel(key);
        var existingLeafNode = existingNodes.leaf;
        var existingDirNode = existingNodes.dir;
        if ((isLeaf && existingLeafNode) || (!isLeaf && existingDirNode)) {
          if (isLeaf) {
            existingLeafNode?.setData(value); // just update the value
            if (existingLeafNode) existingLeafNode.stale = false; // nothing else to change here
          }
          else {
            if (existingDirNode) {
              existingDirNode.stale = false; // nothing to change here
              stack.push({ json: value, node: existingDirNode });
            }
          }
          // leave the node as is
          continue;
        }
        else {
          if (explorer.schema().startsWith('etcd2')) {
            // remove the current node and it'll b replace by new node
            // replacing dir by leaf and leaf by dir
            nodeList.removeNode(isLeaf ? existingDirNode : existingLeafNode);
          }
        }

        if (isLeaf) {
          var prefix = obj.node.prefix + key;
          var parent: EtcdNode | undefined = obj.node;

          /*          if (key == '__EtcdExplorerSpecialCaseVal__') {
                      key = obj.node.label;
                      prefix = obj.node.prefix.replace(new RegExp(separator + '*$'), "");
                      parent = (obj.node.Parent()) ? obj.node.Parent() : explorer.RootNode();
                    }
          */
          if (explorer.getType(value) == "array") {
            for (var data of value) {
              var nObj = Object.create({});
              nObj[key] = data;
              stack.push({ json: nObj, node: obj.node });
            }
            continue;
          }
          var newNode = new EtcdLeafNode(key, prefix, explorer, parent, value);
          parent?.getChildren().pushNode(newNode);
        }
        else {
          var prefix = obj.node.prefix + key + separator;
          var newNode = new EtcdNode(key, prefix, explorer, obj.node);
          nodeList.pushNode(newNode);
          stack.push({ json: value, node: newNode });
        }
      }

      // now remove nodes that are stale
      for (var nodeKey of staleMap.keys()) {
        if (staleMap[nodeKey].stale)
          nodeList.removeNode(staleMap[nodeKey]);
      }
    }
  }

  refreshAllNodes(nodeList?: EtcdNodeList | undefined) {
    if (!this.isVisible) return;

    const nodes = nodeList ? nodeList : this.rootNode.getChildren();
    nodes.removeSpecialNodes();
    for (var n of nodes.toArray()) {
      n.refreshChildren = true;
      this.refreshAllNodes(n.getChildren());
    }
  }

  private _onDidChangeTreeData: vscode.EventEmitter<EtcdNode | undefined> = new vscode.EventEmitter<EtcdNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<EtcdNode | undefined> = this._onDidChangeTreeData.event;

  refresh(): void {
    if (!this.isVisible) return;

    this._onDidChangeTreeData.fire(undefined);
  }

  initClient() {
  }

  refreshData() {
    if (!this.isVisible) return;

    // read the configuration again
    this.initClient();
    if (this.client === undefined) {
      return;
    }
    this.rootNode.getChildren().removeSpecialNodes();
    //this.rootNodeList = new Etcd3NodeList();
    this.initAllData(this.rootNode, this.jsonToLevelNodeList, true, true);

    // recursivly refresh all nodes
    this.refreshAllNodes();
    this.refresh();
  }

  async openResource(node: EtcdNode) {
    if (node === undefined) return;
    var prefix = node.prefix;
    if (node instanceof EtcdSpecialNode) {
      return;
    }
    node.updateValue().then(async (value: any) => {
      //let doc = await vscode.workspace.openTextDocument({ content: value, language: "json" }); // calls back into the provider 
      //var token = require('crypto').randomBytes(48).toString('hex');
      //token = token.toString('base64').replace(/\//g, '_').replace(/:/g, '-');
      //let uri = vscode.Uri.parse(this.schema() + ":" + token + "//" + prefix);
      let uri = vscode.Uri.parse(this.schema() + ":" + prefix);
      let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
      var txt = doc.getText();
      if (txt && txt.length > 0)
        vscode.window.showTextDocument(doc, { preview: false });
    });
  }

  async deleteKeys(prefix: string) {
    return new Promise((resolve, reject) => { resolve(); });
  }

  async initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
  }

  async importResource() {
    var self = this;
    var promise = vscode.window.showOpenDialog({ openLabel: "Open JSON File", canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { "Json Files": ["json"] } });
    promise.then(
      async (jsonFile) => {

        if (jsonFile && jsonFile.length > 0) {
          vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "importing JSON to etcd",
            cancellable: true
          }, (progress, token) => {
            return new Promise(async (resolve) => {
              progress.report({ message: "importing " + jsonFile[0].fsPath + " ..." });
              //console.log(jsonFile);
              var path = jsonFile[0].fsPath;
              const fs = require('fs');
              let rawdata = fs.readFileSync(path);
              let jsonObj = JSON.parse(rawdata);
              await self.jsonToEtcd(jsonObj, token);
              self.refreshData();
              resolve();
            });
          });
        }
      }
    );
  }

  async addKeyValue(nodeResource?: EtcdNode) {
    var node = (nodeResource != undefined) ? nodeResource : this.RootNode();
    var prefix = node.prefix;
    var keyBox = vscode.window.createInputBox();
    keyBox.title = "Add Key Value";
    keyBox.prompt = "Please type your key here?";
    var self = this;
    keyBox.onDidAccept(() => {
      var valueBox = vscode.window.createInputBox();
      valueBox.title = "Add Key Value";
      valueBox.prompt = "Please type your value here?";
      valueBox.onDidAccept(async () => {
        //valueBox.hide();
        var value = valueBox.value;
        var key = keyBox.value;
        valueBox.dispose();
        keyBox.dispose();
        if (key.startsWith(separator)) {
          key = key.replace(separator, "");
        }
        key = prefix + key;
        // convert key value to json
        var labels = key.split(separator).reverse();
        var jsonObj: any = value;
        for (var label of labels) {
          if (!label || label.length == 0)
            continue;
          var newObj = Object.create({});
          newObj[label] = jsonObj;
          jsonObj = newObj;
        }
        await self.jsonToEtcd(jsonObj);
        self.refreshData();
        //self.write(key, value);
        //console.log(inputBox.value + ": " + inputBox2.value);
      });
      valueBox.show();
    });
    keyBox.show();
  }

  async jsonToTextDocument(jsonObj: JSON, node: EtcdNode, explorer: EtcdExplorerBase) {
    var conf = explorer.getConfig();
    var str = "";
    if (conf.exportJSON.nested) {
      str = JSON.stringify(jsonObj);
    }
    else {
      str = "{";
      if (node.isLeafNode()) {
        await node.updateValue();
        str += "\"" + node.prefix + "\": \"" + node.getData() + "\"";
      }
      else {
        var stack = new Array<EtcdNode>();
        stack.push(node);
        while (stack.length > 0) {
          var n = stack.pop();
          for (var ch of n?.getChildren().toArray()) {
            if (ch.isLeafNode()) {
              await ch.updateValue();
              str += ((str == "{") ? "\"" : ", \"") + ch.prefix + "\": \"" + ch.getData() + "\"";
            }
            else {
              stack.push(ch);
            }
          }
        }
      }
      str += "}";
    }
    let doc = await vscode.workspace.openTextDocument({ content: str, language: "json" });
    vscode.window.showTextDocument(doc, { preview: false });
  }


  async exportResource(nodeResource?: EtcdNode) {
    var node = (nodeResource != undefined) ? nodeResource : this.RootNode();
    if (node instanceof EtcdSpecialNode) {
      return;
    }
    var self = this;
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "exporting etcd data to JSON",
      cancellable: true
    }, (progress, token) => {
      return new Promise((resolve) => {
        progress.report({ message: "loading data for " + node.label + " ..." });
        var count = 0;
        self.initAllData(node, this.jsonToTextDocument, false, true);
        resolve();
      });
    });
  }

  async copyResourcePrefix(nodeResource?: EtcdNode) {
    var node = (nodeResource != undefined) ? nodeResource : this.RootNode();
    vscode.env.clipboard.writeText(node.prefix);
  }

  async copyResourceName(nodeResource?: EtcdNode) {
    var node = (nodeResource != undefined) ? nodeResource : this.RootNode();
    vscode.env.clipboard.writeText(node.label);
  }

  async deleteResource(node: EtcdNode) {
    if (node != undefined && node instanceof EtcdSpecialNode) {
      return;
    }
    var self = this;
    var delKeys = function (self: any, key: string) {
      var prompt = vscode.window.showWarningMessage("Are you sure, you wish to delete all keys with prefix " + key, "Yes", "No");
      prompt.then((value) => {
        if (value == "Yes") {
          self.deleteKeys(key).then(() => {
            if (!node) {
              node = self.findEtcdNode(key);
            }
            node = node ? node : self.RootNode();
            var parent = node.Parent();
            if (parent != undefined) {
              parent.getChildren().removeNode(node);
              parent.refreshChildren = true;
              self.refresh();
            }
            if (node == self.RootNode()) {
              node.getChildren().clearChildren();
              self.refreshView();
            }
          }).catch(() => {
            vscode.window.showErrorMessage("Failed to delete keys with prefix " + key);
          });
        }
      });
    }
    if (!node) {
      var keyBox = vscode.window.createInputBox();
      keyBox.title = "Delete Key";
      keyBox.onDidAccept(() => {
        var key = keyBox.value;
        delKeys(self, key);
        keyBox.dispose();
      });
      keyBox.show();
    }
    else {
      delKeys(self, node.prefix);
    }
  }

  async getValue(key: string): Promise<any> { }

  findEtcdNode(key: string, nodeList?: EtcdNodeList | undefined): EtcdNode | undefined {
    var nodes = nodeList ? nodeList : this.RootNode().getChildren(true);
    key = key.replace(new RegExp(separator + '*$'), "");
    var labels = key.split(separator).reverse();
    var node: EtcdNode | undefined;
    while (labels.length > 0) {
      var label = labels.pop();
      if (!label || label.length == 0) continue;
      if (!nodes.hasLabel(label)) return undefined;
      var nodeObj = nodes.getNodeByLabel(label);
      node = nodeObj.dir;
      if (labels.length == 0) {
        node = key.endsWith(separator) ? nodeObj.dir : nodeObj.leaf;
      }
      if (!node) return undefined;
      nodes = node.getChildren();
    }
    if (!node) return undefined;
    return node;
  }
}

export class EtcdNode extends vscode.TreeItem {
  protected isLeaf: boolean;
  protected children: EtcdNodeList;
  private parent?: EtcdNode;
  private explorer: EtcdExplorerBase;
  public refreshChildren = true;
  protected data?: string;
  public stale = false;
  public uri: string;
  constructor(
    public readonly label: string,
    public readonly prefix: string,
    etcd_explorer: EtcdExplorerBase,
    parentNode?: EtcdNode
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = prefix;
    this.isLeaf = false;
    this.explorer = parentNode ? parentNode.explorer : etcd_explorer;
    this.children = new EtcdNodeList(this.explorer);
    this.uri = prefix;
    this.data = undefined;
    this.parent = parentNode;
  }

  contextValue = 'etcdnode_dir';

  isLeafNode(): boolean {
    return this.isLeaf;
  }

  Parent(): EtcdNode | undefined {
    return this.parent;
  }

  getData(): string | undefined {
    if (!this.isLeafNode())
      throw this.prefix + " is not leaf node.";
    return this.data;
  }

  async updateValue(): Promise<any> {
    var data: any;
    var error: any;
    if (!this.isLeafNode())
      error = this.prefix + " is not leaf node.";
    var self = this;
    this.explorer.getValue(this.prefix).then((value: any) => {
      data = value;
      self.data = value;
      let uri = vscode.Uri.parse(this.explorer.schema() + ":" + self.prefix);
      self.explorer.refreshDocument(uri);
    }).catch((reason: string) => {
      error = reason;
    });

    return new Promise((resolve: any) => {
      var interval = setInterval(() => {
        if (data != undefined || error != undefined) {
          clearInterval(interval);
          resolve(error, data);
        }
      }, 100);
    });
  }

  setData(val: string) {
    this.data = val;
    let uri = vscode.Uri.parse(this.explorer.schema() + ":" + this.prefix);
    this.explorer.refreshDocument(uri);
  }

  getChildren(refreshCheck?: boolean): EtcdNodeList {
    var refresh = refreshCheck ? refreshCheck : false;
    if (refresh && this.refreshChildren) {
      this.explorer.initAllData(this, this.explorer.jsonToLevelNodeList, true, true);
      this.refreshChildren = false;
    }
    return this.children;
  }
}

export class EtcdLeafNode extends EtcdNode {
  constructor(
    public readonly label: string,
    public readonly prefix: string,
    etcd_explorer: EtcdExplorerBase,
    parentNode?: EtcdNode,
    value?: string
  ) {
    super(label, prefix, etcd_explorer, parentNode);
    super.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.isLeaf = true;
    this.data = value;
  }
  contextValue = 'etcdnode_leaf';
}

export class EtcdRootNode extends EtcdNode {
  constructor(etcd_explorer: EtcdExplorerBase) {
    super("Root", separator, etcd_explorer);
    this.id = "root" + separator + this.label;
  }
  contextValue = 'etcdrootnode';
}

export class EtcdSpecialNode extends EtcdLeafNode {
  constructor(parent_prefix: string, etcd_explorer: EtcdExplorerBase, parent: EtcdNode, nodeLabel?: string, nodePrefix?: string) {
    super(nodeLabel ? nodeLabel : "Special",
      parent_prefix + (nodePrefix ? nodePrefix : "** special node**"),
      etcd_explorer,
      parent
    );
    this.isLeaf = true;
    // add random token to make id unique
    var token = require('crypto').randomBytes(48).toString('hex');
    token = token.toString('base64').replace(/\//g, '_').replace(/:/g, '-');
    this.id = "special" + separator + this.label + separator + token;
  }
  contextValue = 'specialetcdnode';
}

export class EtcdEmptyWSNode extends EtcdSpecialNode {
  constructor(etcd_explorer: EtcdExplorerBase, parent: EtcdNode) {
    super(separator, etcd_explorer, parent, "Empty Workspace", ">>>empty_workspace<<<");
  }
  contextValue = 'emptyetcdnode';
}

export class EtcdUpdatingNode extends EtcdSpecialNode {
  constructor(etcd_explorer: EtcdExplorerBase, parent: EtcdNode) {
    super(separator, etcd_explorer, parent, "loading", "");
  }

  //iconPath = new vscode.ThemeIcon("tree-item-loading~spin");

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', "light", 'loading.gif'),
    dark: path.join(__filename, '..', '..', 'resources', "dark", 'loading.gif')
  };

  contextValue = 'etcdnodeloading';
}

export class EtcdNodeList {
  protected nodeMap = new HashMap();
  protected updatingNodes: boolean;
  public pageCount = 1;
  private explorer: EtcdExplorerBase;
  private lastUpdated = Date.now() - 10000;
  constructor(etcd_explorer: EtcdExplorerBase) {
    this.updatingNodes = false;
    this.explorer = etcd_explorer;
  }

  clearChildren() {
    for (var node of this.nodeMap.values()) {
      node.getChildren().clearChildren();
    }
    this.nodeMap.clear();
  }

  isUpdating() {
    return this.updatingNodes;
  }

  canUpdate() {
    return (this.updatingNodes == false) && ((Date.now() - this.lastUpdated) > 500);
  }

  updating() {
    this.updatingNodes = true;
  }

  updated() {
    this.updatingNodes = false;
    this.lastUpdated = Date.now();
  }

  removeNode(node?: EtcdNode) {
    if (node != undefined) {
      var p = node.Parent();
      if (p)
        p.refreshChildren = true;
      var key = node.isLeafNode() ? "leaf" + separator + node.label : "dir" + separator + node.label;
      if (node.id?.startsWith('special')) key = node.id;
      this.nodeMap.delete(key);
    }
  }

  removeUpdatingNodes() {
    var spKeys = new Array<string>();
    this.nodeMap.forEach(function (value: any, key: string) {
      if (key.startsWith("special" + separator + "loading"))
        spKeys.push(key);
    });
    for (var key of spKeys) {
      this.nodeMap.delete(key);
    }
  }

  removeSpecialNodes() {
    var spKeys = new Array<string>();
    this.nodeMap.forEach(function (value: any, key: string) {
      if (key.startsWith("special" + separator))
        spKeys.push(key);
    });
    for (var key of spKeys) {
      this.nodeMap.delete(key);
    }
  }

  countSpecialNodes() {
    var spNodes = 0;
    this.nodeMap.forEach(function (value: any, key: string) {
      if (key.startsWith("special" + separator))
        spNodes++;
    });
    return spNodes;
  }

  getNodeByLabel(label: string): { dir: EtcdNode | undefined, leaf: EtcdNode | undefined } {
    var result = Object.create({});
    result["dir"] = this.nodeMap.get("dir" + separator + label);
    result["leaf"] = this.nodeMap.get("leaf" + separator + label);
    return result;
  }

  getNodeById(nodeId: string): EtcdNode | undefined {
    var result: EtcdNode | undefined;
    var labels = nodeId.split(separator);
    while (labels.length > 0) {
      var label = labels.pop();
      if (label && label.length > 0) {
        var val = this.getNodeByLabel(label);
        result = nodeId.endsWith(separator) ? val.dir : val.leaf;
        break;
      }
    }
    return result;
  }

  pushNode(node: EtcdNode) {
    var key = node.isLeafNode() ? "leaf" + separator + node.label : "dir" + separator + node.label;
    if (node.id?.startsWith('special')) key = node.id;
    this.nodeMap.set(key, node);
  }

  pushLabel(label: string, prefix: string, node: EtcdNode, isleaf?: boolean, value?: string) {
    var key = node.isLeafNode() ? "leaf" + separator + node.label : "dir" + separator + node.label;
    if (node.id?.startsWith('special')) key = node.id;
    if (isleaf) {
      this.nodeMap.set(key, new EtcdLeafNode(label, prefix, this.explorer, node, value));
    }
    else {
      this.nodeMap.set(key, new EtcdNode(label, prefix, this.explorer, node));
    }
  }


  hasNode(node: EtcdNode): boolean {
    var key = node.isLeafNode() ? "leaf" + separator + node.label : "dir" + separator + node.label;
    if (node.id?.startsWith('special')) key = node.id;
    return this.nodeMap.has(key);
  }

  hasLabel(label: string): boolean {
    return this.nodeMap.has("leaf" + separator + label) || this.nodeMap.has("dir" + separator + label);
  }

  hasId(nodeId: string): boolean {
    var key = nodeId
    if (!nodeId.startsWith('special')) {
      var labels = nodeId.split(separator);
      while (labels.length > 0) {
        var label = labels.pop();
        if (label && label.length > 0) {
          var key = nodeId.endsWith(separator) ? "dir" + separator + label : "leaf" + separator + label;
          break;
        }
      }
    }
    return this.nodeMap.has(key);
  }

  map() {
    return this.nodeMap;
  }

  toArray() {
    return this.nodeMap.values();
  }
}