import * as vscode from 'vscode';
import * as path from 'path';

var HashMap = require('hashmap');

var separator = "/";

export class EtcdExplorerBase {

  private etcdSch = "";
  private rootNode: EtcdRootNode;
  protected etcd_host: string;
  protected max_keys: number;
  protected client: any;

  constructor(schema: string) {
    console.log("Constructing ETCD Explorer");
    this.etcdSch = schema;
    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    this.max_keys = conf.max_keys_per_level;
    this.etcd_host = conf.etcd_host;
    this.rootNode = new EtcdRootNode(this);
  }

  public RootNode(): EtcdRootNode {
    return this.rootNode;
  }

  schema(): string {
    return this.etcdSch;
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

  jsonToLevelNodeList(jsonObj: JSON, node: EtcdNode) {
    var entries = Object.entries(jsonObj);

    var nodeList = node.getChildren();
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
      var prefix = node.prefix + key + ((isLeaf) ? "" : separator);
      nodeList.pushNode(new EtcdNode(key, prefix, this, node, isLeaf, isLeaf ? value : ""));
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
    var conf = vscode.workspace.getConfiguration('etcd-explorer');
    this.max_keys = conf.max_keys_per_level;
    this.etcd_host = conf.etcd_host;
  }

  refreshData() {
    // read the configuration again
    this.initClient();
    if (this.client === undefined) {
      return;
    }
    this.rootNode.getChildren().removeSpecialNodes();
    //this.rootNodeList = new Etcd3NodeList();
    this.initAllData(this.rootNode, this.jsonToLevelNodeList);

    // recursivly refresh all nodes
    this.refreshAllNodes();
    this.refresh();
  }

  async openResource(node: EtcdNode) {
    var prefix = node.prefix;
    if (node instanceof EtcdPagerNode) {
      var parent_node = node.Parent();
      var nodeList;
      nodeList = parent_node?.getChildren();
      nodeList?.removeNode(node);
      nodeList ? nodeList.pageCount++ : null;
      if (parent_node != undefined) parent_node.refreshChildren = true;
      this.refresh();
      return;
    }
    let uri = vscode.Uri.parse(this.schema() + ":" + prefix);
    let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
    vscode.window.showTextDocument(doc, { preview: false });
  }

  deleteKeys(prefix: string) {
  }

  initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) { }

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

  async deleteResource(node: EtcdNode) {
    if (node instanceof EtcdSpecialNode) {
      return;
    }
    var prompt = vscode.window.showWarningMessage("Are you sure, you wish to delete all keys with prefix " + node.prefix, "Yes", "No");
    prompt.then((value) => {
      if (value == "Yes") {
        this.deleteKeys(node.prefix);
        var parent = node.Parent();
        if (parent != undefined) {
          parent.getChildren().removeNode(node);
          parent.refreshChildren = true;
          this.refresh();
        }
      }
    });
  }

  findEtcdNode(key: string, nodeList?: EtcdNodeList | undefined): EtcdNode | undefined {
    const nodes = nodeList ? nodeList : this.rootNode.getChildren();
    for (var n of nodes.toArray()) {
      if (key == n.prefix) {
        return n;
      }
      var rval = this.findEtcdNode(key, n.getChildren());
      if (rval != undefined) return rval;
    }
    return undefined;
  }

  findEtcdNodeData(key: string, nodeList?: EtcdNodeList | undefined): string {
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
  private isLeaf: boolean;
  protected children: EtcdNodeList;
  private parent?: EtcdNode;
  private explorer: EtcdExplorerBase;
  public refreshChildren = true;
  private data?: string;
  public stale = false;
  public uri: string;
  public specialKey: string;
  constructor(
    public readonly label: string,
    public readonly prefix: string,
    etcd_explorer: EtcdExplorerBase,
    parentNode?: EtcdNode,
    leafNode?: boolean,
    value?: string
  ) {
    super(label, leafNode ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.specialKey = label;
    this.isLeaf = leafNode ? leafNode : false;
    this.explorer = parentNode ? parentNode.explorer : etcd_explorer;
    this.children = new EtcdNodeList(this.explorer);
    this.uri = prefix;
    this.data = value;
    this.parent = parentNode;
  }

  contextValue = 'etcdnode';

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
      this.explorer.initAllData(this, this.explorer.jsonToLevelNodeList);
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

export class EtcdRootNode extends EtcdNode {
  constructor(etcd_explorer: EtcdExplorerBase) {
    super("Root", separator, etcd_explorer);
    this.specialKey = separator + this.label;
  }
  contextValue = 'etcdrootnode';
}

export class EtcdSpecialNode extends EtcdNode {
  constructor(parent_prefix: string, etcd_explorer: EtcdExplorerBase, parent: EtcdNode, nodeLabel?: string, nodePrefix?: string) {
    super(nodeLabel ? nodeLabel : "Special",
      parent_prefix + (nodePrefix ? nodePrefix : "** special node**"),
      etcd_explorer,
      parent,
      true
    );
    this.specialKey = separator + this.label;
  }
  contextValue = 'specialetcdnode';
}

export class EtcdPagerNode extends EtcdSpecialNode {
  constructor(parent_prefix: string, etcd_explorer: EtcdExplorerBase, parent: EtcdNode) {
    super(parent_prefix, etcd_explorer, parent, "next->");
  }
  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'pager.gif'),
    dark: path.join(__filename, '..', '..', 'resources', 'pager.gif')
  };
  contextValue = 'pageretcdnode';
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
  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'loading.gif'),
    dark: path.join(__filename, '..', '..', 'resources', 'loading.gif')
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
    this.nodeMap.set(label, new EtcdNode(label, pre, this.explorer, node, isleaf, value));
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