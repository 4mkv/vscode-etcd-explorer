import * as vscode from 'vscode';
import * as path from 'path';

var HashMap = require('hashmap');

var separator = "/";

export class EtcdExplorerBase {
  private etcdSch = "";
  private rootNode: EtcdRootNode;
  protected etcd_host?: string;
  protected client: any;
  protected conflictsResolution = "abort";
  protected sameKeysResolution = "abort";
  constructor(schema: string) {
    console.log("Constructing ETCD Explorer");
    this.etcdSch = schema;

    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    var importJSON = conf.importJSON;
    console.log(importJSON);
    this.conflictsResolution = importJSON.conflicts;
    this.sameKeysResolution = importJSON.sameKeys;
    this.rootNode = new EtcdRootNode(this);
  }

  public RootNode(): EtcdRootNode {
    return this.rootNode;
  }

  schema(): string {
    return this.etcdSch;
  }

  clearView() {
    this.RootNode().getChildren().clearChildren();
    this.refresh();
  }

  refreshView(clusterHost: string) {
    if (clusterHost != this.etcd_host) {
      this.etcd_host = clusterHost;
      this.refreshData();
    }
  }

  getChildren(element?: EtcdNode): Thenable<EtcdNode[]> {
    element = element ? element : this.rootNode;
    var children = element.getChildren(true);
    children.removeUpdatingNodes();
    if (children.updatingNodes) {
      var arrayChildren = children.toArray();
      arrayChildren.push(new EtcdUpdatingNode(this, this.rootNode));
      return Promise.resolve(arrayChildren);
    }
    if (this.rootNode.getChildren(true).toArray().length == 0) {
      return Promise.resolve([new EtcdEmptyWSNode(this, this.rootNode)]);
    }
    return Promise.resolve(element.getChildren().toArray());
  }

  protected write(key: string, value: any) { }

  jsonToEtcd(jsonObj: JSON) {
    if (this.client === undefined) return;
    var currentKey = "";
    var writes = new Array<{ value: string, key: string }>();
    var conflicts = new Array<{ value: string, key: string, srcLeaf: boolean, dstLeaf: boolean }>();
    var stack = new Array<{ json: JSON, key: string }>();
    stack.push({ json: jsonObj, key: currentKey });
    while (stack.length > 0) {
      var obj = stack.pop();
      if (!obj) break;
      var json = obj.json;
      var entries = Object.entries(json);
      for (var entry of entries) {
        currentKey = obj.key;
        var isLeaf = false;
        var key = entry[0];
        var value = entry[1];
        var str = Object.prototype.toString.call(value);
        var type = str.slice(8, -1).toLowerCase();
        if (type == "string"
          || type == "boolean"
          || type == "number"
          || type == "date"
          || type == "array"
          || type == "undefined"
          || type == "null"
        ) {
          isLeaf = true;
        }
        else {
          isLeaf = false;
        }
        currentKey += separator + key;
        var existingNode = this.findEtcdNode(currentKey);
        if (!existingNode) {
          existingNode = this.findEtcdNode(currentKey + separator);
        }
        if (!isLeaf) {
          if (existingNode && existingNode.isLeafNode()) {
            conflicts.push({ key: currentKey, value: value, srcLeaf: isLeaf, dstLeaf: existingNode.isLeafNode() });
          }
          stack.push({ json: value, key: currentKey });
        }
        else {
          if (existingNode) {
            if (!existingNode.isLeafNode()) {
              conflicts.push({ key: currentKey, value: value, srcLeaf: isLeaf, dstLeaf: existingNode.isLeafNode() });
            }
            conflicts.push({ key: currentKey, value: value, srcLeaf: isLeaf, dstLeaf: existingNode.isLeafNode() });
          }
          else {
            if (type == "array") {
              var index = 0;
              for (var val of value) {
                var valObj = Object.create({});
                valObj["[" + index + "]"] = val;
                index++;
                stack.push({ key: currentKey, json: valObj });
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
      var p = new Promise(async (resolve) => {
        var str = "Conflicts:\n ==================================\n";
        for (var c of conflicts) {
          str += c.key + ": " + c.value + "\n";
        }
        let doc = await vscode.workspace.openTextDocument({ content: str, language: "json" });
        vscode.window.showTextDocument(doc, { preview: false });
        resolve();
      });

      for (var conflict of conflicts) {
        if (conflict.srcLeaf != conflict.dstLeaf) {
          if (this.conflictsResolution == "abort") {
            vscode.window.showErrorMessage("Aborting json import due to conflict with existing keys");
            return;
          }
          if (this.conflictsResolution == "ignore")
            continue;
          if (this.conflictsResolution == "overwrite")
            writes.push({ key: conflict.key, value: conflict.value });
        }
        else {
          if (this.sameKeysResolution == "abort") {
            vscode.window.showErrorMessage("Aborting json import as some keys already exist");
            return;
          }
          if (this.sameKeysResolution == "ignore")
            continue;
          if (this.sameKeysResolution == "overwrite")
            writes.push({ key: conflict.key, value: conflict.value });
        }
      }
    }
    for (var write of writes) {
      this.write(write.key, write.value);
    }
  }

  jsonToLevelNodeList(jsonObj: JSON, node: EtcdNode) {

    var stack = Array<{ json: JSON, node: EtcdNode }>();
    stack.push({ json: jsonObj, node: node });

    while (stack.length > 0) {
      var obj = stack.pop();
      if (!obj) break;
      var entries = Object.entries(obj.json);
      var nodeList = obj.node.getChildren();
      var currentLabels = [];
      for (var chNode of nodeList.toArray()) {
        chNode.stale = true;
        currentLabels.push(chNode.label);
      }
      for (var entry of entries) {
        var isLeaf = false;
        var key = entry[0];
        var value = entry[1];
        var str = Object.prototype.toString.call(value);
        var type = str.slice(8, -1).toLowerCase();
        if (type == "string"
          || type == "boolean"
          || type == "number"
          || type == "date"
          || type == "array"
          || type == "undefined"
          || type == "null"
        ) {
          isLeaf = true;
        }
        else {
          isLeaf = false;
        }
        if (currentLabels.indexOf(key) > -1) {
          var existingNode = nodeList.getNode(key);
          if (existingNode != undefined && existingNode.isLeafNode() == isLeaf) {
            existingNode.stale = false;
            continue;
          }
          else {
            nodeList.removeNode(existingNode);
          }
        }
        if (isLeaf) {
          var prefix = obj.node.prefix + key;
          var newNode = new EtcdLeafNode(key, prefix, this, obj.node, value);
          nodeList.pushNode(newNode);
        }
        else {
          var prefix = obj.node.prefix + key + separator;
          var newNode = new EtcdNode(key, prefix, this, obj.node);
          nodeList.pushNode(newNode);
          stack.push({ json: value, node: newNode });
        }
      }

      var removal = []
      for (chNode of nodeList.toArray()) {
        if (chNode.stale)
          removal.push(chNode);
      }
      for (var chNode of removal) {
        nodeList.removeNode(chNode);
      }
      nodeList.updatingNodes = false;
    }
  }

  refreshAllNodes(nodeList?: EtcdNodeList | undefined) {
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
    this._onDidChangeTreeData.fire(undefined);
  }

  initClient() {
  }

  refreshData() {
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
    let uri = vscode.Uri.parse(this.schema() + ":" + prefix);
    let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider 
    vscode.window.showTextDocument(doc, { preview: false });
  }

  deleteKeys(prefix: string): Thenable<void> {
    return Promise.resolve();
  }

  initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) { }

  async importResource() {
    var self = this;
    var promise = vscode.window.showOpenDialog({ openLabel: "Open JSON File", canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { "Json Files": ["json"] } });
    promise.then(
      (jsonFile) => {
        //console.log(jsonFile);
        if (jsonFile && jsonFile.length > 0) {
          var path = jsonFile[0].fsPath;
          const fs = require('fs');
          let rawdata = fs.readFileSync(path);
          let jsonObj = JSON.parse(rawdata);
          self.jsonToEtcd(jsonObj);
          self.refresh();
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
      valueBox.onDidAccept(() => {
        valueBox.hide();
        var value = valueBox.value;
        var key = keyBox.value;
        if (key.startsWith(separator)) {
          key = key.replace(separator, "");
        }
        key = prefix + key;
        self.write(key, value);
        //console.log(inputBox.value + ": " + inputBox2.value);
      });
      valueBox.show();
    });
    keyBox.show();
  }

  async exportResource(nodeResource?: EtcdNode) {
    var node = (nodeResource != undefined) ? nodeResource : this.RootNode();
    if (node instanceof EtcdSpecialNode) {
      return;
    }

    var promise = vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "exporting etcd data to JSON",
      cancellable: true
    }, (progress, token) => {
      progress.report({ message: "loading data for " + node.label + " ..." });
      var count = 0;
      var p = new Promise((resolve, reject) => {
        this.initAllData(node, async (jsonObj: JSON, etcdNode: EtcdNode) => {
          var str = JSON.stringify(jsonObj);
          let doc = await vscode.workspace.openTextDocument({ content: str, language: "json" });
          vscode.window.showTextDocument(doc, { preview: false });
          resolve();
        }, false, true);
      });
      return p;
    });
    promise.then(async () => {
    }, (reason) => { console.log(reason); });
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
    if (node === undefined) return;
    if (node instanceof EtcdSpecialNode) {
      return;
    }
    var prompt = vscode.window.showWarningMessage("Are you sure, you wish to delete all keys with prefix " + node.prefix, "Yes", "No");
    prompt.then((value) => {
      if (value == "Yes") {
        var promise = this.deleteKeys(node.prefix);
        promise.then(() => {
          var parent = node.Parent();
          if (parent != undefined) {
            parent.getChildren().removeNode(node);
            parent.refreshChildren = true;
            this.refresh();
          }
        });
      }
    });
  }

  findEtcdNode(key: string, nodeList?: EtcdNodeList | undefined): EtcdNode | undefined {
    const nodes = nodeList ? nodeList : this.rootNode.getChildren();
    for (var n of nodes.toArray()) {
      if (key == n.prefix) {
        return n;
      }
      n.refreshChildren = true;
      var rval = this.findEtcdNode(key, n.getChildren(true));
      if (rval != undefined) return rval;
    }
    return undefined;
  }

  findEtcdNodeData(key: string, nodeList?: EtcdNodeList | undefined): string {
    key = decodeURI(key);
    const nodes = nodeList ? nodeList : this.rootNode.getChildren();
    for (var n of nodes.toArray()) {
      if (key.startsWith(n.prefix)) {
        if (n.isLeafNode())
          return n.Value();
        return this.findEtcdNodeData(key, n.getChildren());
      }
    }
    return "==>Key Not Found<=="
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
  public specialKey: string;
  constructor(
    public readonly label: string,
    public readonly prefix: string,
    etcd_explorer: EtcdExplorerBase,
    parentNode?: EtcdNode
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.specialKey = label;
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

  Value(): string {
    if (!this.isLeafNode())
      return "==>Not a leaf Node<==";
    return this.data ? this.data : "==>No Value<==";
  }

  setValue(val: string) {
    this.data = val;
  }



  getChildren(refreshCheck?: boolean): EtcdNodeList {
    var refresh = refreshCheck ? refreshCheck : false;
    if (refresh && this.refreshChildren) {
      this.explorer.initAllData(this, this.explorer.jsonToLevelNodeList, true, true);
      this.refreshChildren = false;
    }
    return this.children;
  }

  nodeJSONObj(): Object {
    var nodes = this.getChildren().toArray();
    var ready = !this.getChildren().updatingNodes;
    const out = Object.create(null);

    if (ready) {
      if (this.isLeaf) {
        out[this.label] = this.Value();
      }
      else {
        nodes = this.getChildren().toArray();
        if (nodes.length == 0) {
        }
        else if (nodes.length == 1) {
          var obj = nodes[0].nodeJSONObj();
          out[this.label] = obj;
        }
        else {
          var arr = Object.create(null)
          for (var n of this.getChildren().toArray()) {
            var obj = n.nodeJSONObj();
            for (var entry of Object.entries(obj)) {
              arr[entry[0]] = entry[1];
            }
          }
          out[this.label] = arr;
        }
      }
    }
    return out;
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
    this.specialKey = separator + this.label;
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
    this.specialKey = separator + this.label;
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
  public updatingNodes: boolean;
  public pageCount = 1;
  private explorer: EtcdExplorerBase;
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

  removeNode(node?: EtcdNode) {
    if (node != undefined)
      this.nodeMap.delete(node.specialKey);
  }

  removeUpdatingNodes() {
    this.nodeMap.delete(separator + "loading");
  }

  removeSpecialNodes() {
    this.nodeMap.delete(separator + "Special");
    this.nodeMap.delete(separator + "next->");
    this.nodeMap.delete(separator + "Empty Workspace");
    this.nodeMap.delete(separator + "loading");
  }

  countSpecialNodes() {
    var spNodes = 0;
    var sp = [
      separator + "Special",
      separator + "next->",
      separator + "Empty Workspace",
      separator + "loading"
    ];
    for (var spLabel of sp) {
      if (this.nodeMap.has(spLabel)) {
        spNodes++;
      }
    }
    return spNodes;
  }

  getNode(label: string): EtcdNode | undefined {
    var result = undefined;
    result = this.nodeMap.get(label);
    return result;
  }

  pushNode(node: EtcdNode) {
    this.nodeMap.set(node.specialKey, node);
  }

  pushLabel(label: string, pre: string, node: EtcdNode, isleaf?: boolean, value?: string) {
    if (isleaf) {
      this.nodeMap.set(label, new EtcdLeafNode(label, pre, this.explorer, node, value));
    }
    else {
      this.nodeMap.set(label, new EtcdNode(label, pre, this.explorer, node));
    }
  }


  hasNode(node: EtcdNode): boolean {
    return this.nodeMap.has(node.specialKey);
  }

  hasLabel(label: string): boolean {
    return this.nodeMap.has(label);
  }

  map() {
    return this.nodeMap;
  }

  toArray() {
    return this.nodeMap.values();
  }
}