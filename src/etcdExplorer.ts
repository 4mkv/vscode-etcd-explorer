import * as vscode from 'vscode';
import * as path from 'path';
import { Hash } from 'crypto';

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

  updatingTreeData() {
    //return new Promise((resolve, reject) => {
    //this.rootNode.getChildren().updatingStr = "Updating";
    //console.log(this.rootNode.getChildren().updatingStr);
    //var self = this;
    // setTimeout(function () {
    //  self.refresh();
    //}, 300);
    //});
  }

  getChildren(element?: EtcdNode): Thenable<EtcdNode[]> {
    element = element ? element : this.rootNode;
    var children = element.getChildren(true);
    children.removeUpdatingNodes();
    if (children.updatingNodes) {
      //console.log("getChildren => " + element.getChildren().updatingStr);
      //this.updatingTreeData();
      var arrayChildren = children.toArray();
      arrayChildren.push(new EtcdUpdatingNode(this, this.rootNode));
      return Promise.resolve(arrayChildren);
    }
    if (this.rootNode.getChildren(true).toArray().length == 0) {
      //console.log("getChildren Empty WS");
      return Promise.resolve([new EtcdEmptyWSNode(this, this.rootNode)]);
    }
    //console.log("getChildren node " + element.label + " => " + element.getChildren().toArray().length);
    //if (element.getChildren(true).updatingNodes)
    //this.updatingTreeData();
    return Promise.resolve(element.getChildren().toArray());
  }

  initLevelData(node: EtcdNode) {
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
    this.initLevelData(this.rootNode);

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

  deepInitData(node: EtcdNode, cancelTask: vscode.CancellationToken, progress: vscode.Progress<{
    message?: string | undefined;
    increment?: number | undefined;
  }>) { }

  async exportResource(node: EtcdNode) {
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
        this.deepInitData(node, token, progress);
        var timeout = setInterval(async () => {
          count++;
          if (token.isCancellationRequested) {
            clearInterval(timeout);
            reject("Task Cancelled");
          }
          if (node.getChildren().updatingNodes == false) {
            clearInterval(timeout);
            resolve();
          }
        }, 500);
      });
      return p;
    });
    promise.then(async () => {
      var obj = node.nodeJSONObj();
      var str = JSON.stringify(obj);
      let doc = await vscode.workspace.openTextDocument({ content: str, language: "json" });
      vscode.window.showTextDocument(doc, { preview: false });
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
  public uri: string;
  constructor(
    public readonly label: string,
    public readonly prefix: string,
    etcd_explorer: EtcdExplorerBase,
    parentNode?: EtcdNode,
    leafNode?: boolean,
    value?: string
  ) {
    super(label, leafNode ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.isLeaf = leafNode ? leafNode : false;
    this.children = new EtcdNodeList(etcd_explorer);
    this.explorer = etcd_explorer;
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

  getChildren(refreshCheck?: boolean): EtcdNodeList {
    var refresh = refreshCheck ? refreshCheck : false;
    if (refresh && this.refreshChildren) {
      this.explorer.initLevelData(this);
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
  }
  contextValue = 'etcdrootnode';
}

export class EtcdSpecialNode extends EtcdNode {
  constructor(parent_prefix: string, etcd_explorer: EtcdExplorerBase, parent: EtcdNode, nodeLabel?: string, nodePrefix?: string) {
    super(nodeLabel ? nodeLabel : "**Special Node**",
      parent_prefix + (nodePrefix ? nodePrefix : "** special node**"),
      etcd_explorer,
      parent,
      true
    );
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
  protected nodes: Array<EtcdNode>;
  public updatingNodes: boolean;
  public updatingStr = "loading";
  public pageCount = 1;
  private explorer: EtcdExplorerBase;
  constructor(etcd_explorer: EtcdExplorerBase) {
    this.updatingNodes = false;
    this.explorer = etcd_explorer;
    this.nodes = new Array<EtcdNode>();
  }

  removeNode(node?: EtcdNode) {
    if (node != undefined)
      this.nodes.splice(this.nodes.indexOf(node), 1);
  }

  removeUpdatingNodes() {
    var spNodes = []
    for (var node of this.nodes) {
      if (node instanceof EtcdUpdatingNode) {
        spNodes.push(node);
      }
    }
    for (var n of spNodes) {
      this.removeNode(n);
    }
  }

  removeSpecialNodes() {
    var spNodes = []
    for (var node of this.nodes) {
      if (node instanceof EtcdSpecialNode) {
        spNodes.push(node);
      }
    }
    for (var n of spNodes) {
      this.removeNode(n);
    }
  }

  countSpecialNodes() {
    var spNodes = 0
    for (var node of this.nodes) {
      if (node instanceof EtcdSpecialNode) {
        spNodes++;
      }
    }
    return spNodes;
  }

  getNode(n: string): EtcdNode | undefined {
    var result = undefined;
    for (var node of this.nodes) {
      if (n == node.label) {
        result = node;
        break;
      }
    }
    return result;
  }

  pushNode(n: EtcdNode) {
    this.nodes.push(n);
  }

  pushLabel(label: string, pre: string, node: EtcdNode, isleaf?: boolean, value?: string) {
    this.nodes.push(new EtcdNode(label, pre, this.explorer, node, isleaf, value));
  }


  hasNode(n: EtcdNode): boolean {
    var doesIt = false;
    for (var node of this.nodes) {
      if (n.label == node.label) {
        doesIt = true;
        break;
      }
    }
    return doesIt;
  }

  hasLabel(n: string): boolean {
    var doesIt = false;
    for (var node of this.nodes) {
      if (n == node.label) {
        doesIt = true;
        break;
      }
    }
    return doesIt;
  }

  toArray() {
    return this.nodes;
  }

}