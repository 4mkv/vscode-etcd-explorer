import * as vscode from 'vscode';
import { Etcd2Explorer } from './etcd2Explorer';
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
    var conf = vscode.workspace.getConfiguration('etcd-manager');
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
    return new Promise((resolve, reject) => {
      var i = this.rootNode.getChildren().updatingStr.length % 3;
      var str = " .";
      while (i-- > 0) {
        str += ".";
      }
      this.rootNode.getChildren().updatingStr = "Updating" + str;
      console.log(this.rootNode.getChildren().updatingStr);
      var self = this;
      setTimeout(function () {
        self.refresh();
      }, 300);
    });
  }

  getChildren(element?: EtcdNode): Thenable<EtcdNode[]> {
    element = element ? element : this.rootNode;
    if (this.rootNode.getChildren(true).updatingNodes) {
      console.log("getChildren => " + this.rootNode.getChildren().updatingStr);
      this.updatingTreeData();
      return Promise.resolve([new EtcdUpdatingNode(this, this.rootNode)]);
    }
    if (this.rootNode.getChildren(true).toArray().length == 0) {
      console.log("getChildren Empty WS");
      return Promise.resolve([new EtcdEmptyWSNode(this, this.rootNode)]);
    }
    console.log("getChildren node " + element.label + " => " + element.getChildren().toArray().length);
    if (element.getChildren(true).updatingNodes)
      this.updatingTreeData();
    return Promise.resolve(element.getChildren().toArray());
  }

  initLevelData(prefix: string, node: EtcdNode) {
  }

  refreshAllNodes(nodeList?: EtcdNodeList | undefined) {
    const nodes = nodeList ? nodeList : this.rootNode.getChildren();
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
    var conf = vscode.workspace.getConfiguration('etcd-manager');
    this.max_keys = conf.max_keys_per_level;
    this.etcd_host = conf.etcd_host;
  }

  refreshData() {
    // read the configuration again
    this.initClient();
    if (this.client === undefined) {
      return;
    }
    //this.rootNodeList = new Etcd3NodeList();
    this.initLevelData(separator, this.rootNode);

    // recursivly refresh all nodes
    this.refreshAllNodes();
    this.refresh();
  }

  async openResource(node: EtcdNode) {
    var prefix = node.prefix;
    if (node instanceof EtcdSpecialNode) {
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

  async deleteResource(node: EtcdNode) {
    if (node instanceof EtcdSpecialNode) {
      return;
    }
    this.deleteKeys(node.prefix);
    var parent = node.Parent();
    if (parent != undefined) {
      parent.getChildren().removeNode(node);
      parent.refreshChildren = true;
      this.refresh();
    }
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
  private children: EtcdNodeList;
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
      this.explorer.initLevelData(this.prefix, this);
      this.refreshChildren = false;
    }
    return this.children;
  }
}

export class EtcdRootNode extends EtcdNode {
  constructor(etcd_explorer: EtcdExplorerBase) {
    super("Root", "/", etcd_explorer);
  }
}

export class EtcdSpecialNode extends EtcdNode {
  constructor(parent_prefix: string, etcd_explorer: EtcdExplorerBase, parent: EtcdNode, nodeLabel?: string, nodePrefix?: string) {
    super(nodeLabel ? nodeLabel : "More nodes >>>",
      parent_prefix + (nodePrefix ? nodePrefix : "more_nodes>>>"),
      etcd_explorer,
      parent,
      true
    );
  }
}

export class EtcdEmptyWSNode extends EtcdSpecialNode {
  constructor(etcd_explorer: EtcdExplorerBase, parent: EtcdNode) {
    super("/", etcd_explorer, parent, "Empty Workspace", ">>>empty_workspace<<<");
  }
}

export class EtcdUpdatingNode extends EtcdSpecialNode {
  constructor(etcd_explorer: EtcdExplorerBase, parent: EtcdNode) {
    super("/", etcd_explorer, parent, parent.getChildren().updatingStr, ">>>updating<<<");
  }
}

export class EtcdNodeList {
  protected nodes: Array<EtcdNode>;
  public updatingNodes: boolean;
  public updatingStr = "Updating";
  public pageCount = 1;
  private explorer: EtcdExplorerBase;
  constructor(etcd_explorer: EtcdExplorerBase) {
    this.updatingNodes = false;
    this.explorer = etcd_explorer;
    this.nodes = new Array<EtcdNode>();
    this.updatingStr = "Updating" + etcd_explorer.schema();
  }

  removeNode(node?: EtcdNode) {
    if (node != undefined)
      this.nodes.splice(this.nodes.indexOf(node), 1);
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