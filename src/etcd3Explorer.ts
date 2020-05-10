import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode, EtcdSpecialNode } from "./etcdExplorer"

var separator = "/";
var schema = "etcd3_value_text_schema"
const { Etcd3 } = require('etcd3');

export class Etcd3Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  private client: any;

  constructor() {
    super(schema)
    this.client = new Etcd3({ hosts: this.etcd_host, grpcOptions: { "grpc.max_receive_message_length": -1, }, });
    this.initLevelData(separator, this.RootNode());
    console.log("Done .. nodes");
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode() && !(element instanceof EtcdSpecialNode)) {
      element.command = { command: 'etcd3view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  async deleteKeys(prefix: string) {
    const ns = this.client.namespace(prefix);
    await ns.delete().all(); // deletes all keys with the prefix
  }

  initLevelData(prefix: string, node: EtcdNode) {
    var nodeList = node.getChildren();
    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;
    var isLeaf = false;
    console.log("initTreeData");
    const promise_keys = this.client.getAll().prefix(prefix).strings();
    console.log("initTreeData => getAll");
    promise_keys.then((val: any) => {
      console.log("initTreeData => values");
      var count = 0;
      for (var key in val) {
        var words = key.split(prefix);
        if (words.length > 1) {
          var tail = words[1];
          if (tail.length > 0) {
            var tailwords = tail.split(separator)
            var keyw = tailwords[0];
            if (tail.startsWith(separator))
              keyw = tailwords[1];
            if ((tail == keyw) && (words.length == 2))
              isLeaf = true;
            var pre = "";
            if (!nodeList.hasLabel(keyw)) {
              if (prefix.endsWith(separator))
                pre = prefix + keyw;
              else
                pre = prefix + separator + keyw;
              if (!isLeaf) {
                pre += "/";
                nodeList.pushLabel(keyw, pre, node, isLeaf);
              }
              else {
                nodeList.pushLabel(keyw, pre, node, isLeaf, val[key]);
              }
              console.log("key:" + keyw);
              nodeList.updatingNodes = false;
              count++;
              if (count >= (this.max_keys * nodeList.pageCount)) {
                nodeList.pushNode(new EtcdSpecialNode(prefix, this, node));
                break;
              }
            }
          }
        }
      }
      nodeList.updatingNodes = false;
      console.log("initTreeData => upDating done");
    }, (error: string) => { console.log(error); nodeList.updatingNodes = false; });
  }

}
