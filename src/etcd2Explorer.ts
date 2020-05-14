import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode, EtcdSpecialNode } from "./etcdExplorer"
const Etcd2 = require('node-etcd');

var separator = "/";
var schema = "etcd2_value_text_schema"

export class Etcd2Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {

  constructor() {
    super(schema);
    this.initClient();
  }

  initClient() {
    super.initClient();
    if (!this.etcd_host) {
      return;
    }
    this.client = new Etcd2([this.etcd_host]);
    this.initLevelData(separator, this.RootNode());
    console.log("Done .. nodes");
    this.client.selfStats(console.log);
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode() && !(element instanceof EtcdSpecialNode)) {
      element.command = { command: 'etcd2view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  deleteKeys(prefix: string) {
    this.client.del(prefix, { recursive: true }, console.log);
  }

  initLevelData(prefix: string, node: EtcdNode) {
    var nodeList = node.getChildren();
    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;
    var isLeaf = false;
    console.log("initTreeData");
    //const promise_keys = client.getAll().prefix(prefix).strings();
    this.client.get(prefix, { recursive: true },
      (err: any, val: any) => {
        if (val === undefined) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          nodeList.updatingNodes = false;
          return;
        }
        console.log(Object.prototype.toString.call(val));
        //console.log(Object.prototype.toString.call(key));
        var root = val.node;
        var count = 0;
        for (var n in root.nodes) {
          console.log(root.nodes[n].key);
          var keyw = root.nodes[n].key.substring(root.nodes[n].key.lastIndexOf(prefix) + prefix.length);
          isLeaf = !root.nodes[n].dir;
          var pre = root.nodes[n].key;
          if (!nodeList.hasLabel(keyw)) {
            if (!isLeaf) {
              pre += "/";
              nodeList.pushLabel(keyw, pre, node, isLeaf);
            }
            else {
              nodeList.pushLabel(keyw, pre, node, isLeaf, root.nodes[n].value);
            }
          }
          nodeList.updatingNodes = false;
          count++;
          if (count >= (this.max_keys * nodeList.pageCount)) {
            nodeList.pushNode(new EtcdSpecialNode(prefix, this, node));
            break;
          }
        }
        nodeList.updatingNodes = false;
      }
    );
  }
}

