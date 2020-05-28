import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode, EtcdPagerNode } from "./etcdExplorer"

var separator = "/";
var schema = "etcd3_value_text_schema"
const { Etcd3 } = require('etcd3');

export class Etcd3Explorer extends EtcdExplorerBase implements vscode.TreeDataProvider<EtcdNode> {
  constructor() {
    super(schema)
    this.initClient();
  }

  initClient() {
    super.initClient();
    if (!this.etcd_host) {
      return;
    }
    this.client = new Etcd3({ hosts: this.etcd_host, grpcOptions: { "grpc.max_receive_message_length": -1, "grpc.grpclb_call_timeout_ms": 600000, }, });
    this.initLevelData(this.RootNode());
    console.log("Done .. nodes");
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode()) {
      element.command = { command: 'etcd3view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  async deleteKeys(prefix: string) {
    const ns = this.client.namespace(prefix);
    await ns.delete().all(); // deletes all keys with the prefix
  }

  initLevelData(node: EtcdNode) {
    var prefix = node.prefix;
    console.log("updating " + prefix);
    var nodeList = node.getChildren();
    var removeList: EtcdNode[] = [];

    // list of elements to remove if they no longer exist
    for (var n of nodeList.toArray()) {
      removeList.push(n);
    }

    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;

    var isLeaf = false;
    //console.log("initTreeData");
    const promise_keys = this.client.getAll().prefix(prefix).strings();
    //console.log("initTreeData => getAll");
    var self = this;
    promise_keys.then((val: any) => {
      //console.log("initTreeData => values");
      var count = nodeList.toArray().length - nodeList.countSpecialNodes();
      for (var key in val) {
        //console.log(key);
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
              if (this.max_keys > 0) {
                if (count >= (this.max_keys * nodeList.pageCount)) {
                  nodeList.pushNode(new EtcdPagerNode(prefix, this, node));
                  break;
                }
              }
              if (prefix.endsWith(separator))
                pre = prefix + keyw;
              else
                pre = prefix + separator + keyw;
              if (!isLeaf) {
                pre += "/";
                nodeList.pushLabel(keyw, pre, node, isLeaf);
                count++;
              }
              else {
                nodeList.pushLabel(keyw, pre, node, isLeaf, val[key]);
                count++;
              }
              //console.log("key:" + keyw);
              nodeList.updatingNodes = false;
              self.refresh();
            }
            else {
              // OK this element still exists and thus need not be removed
              // so remove it from removeList
              removeList.splice(removeList.findIndex((n) => {
                if (n.label == keyw) return true;
                return false;
              }), 1);
            }
          }
        }
      }
      // remove elements still in removeList
      for (var n of removeList) {
        nodeList.removeNode(n);
      }
      nodeList.updatingNodes = false;
      self.refresh();
      console.log("initTreeData => upDating done for " + prefix);
    }, (error: string) => {
      console.log(error);
      vscode.window.showErrorMessage(error.toString());
      nodeList.updatingNodes = false;
      self.refresh();
    });
  }

  deepInitData(node: EtcdNode, cancelToken: vscode.CancellationToken, progress: vscode.Progress<{
    message?: string | undefined;
    increment?: number | undefined;
  }>) {
    var prefix = node.prefix;
    console.log("updating " + prefix);
    var nodeList = node.getChildren();
    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;

    // remove all children 
    nodeList.toArray().splice(0, nodeList.toArray().length);
    node.refreshChildren = true;

    var isLeaf = false;
    progress.report({
      message: "getting keys from etcd for prefix " + prefix
    });
    const promise_keys = this.client.getAll().prefix(prefix).strings();
    var self = this;
    promise_keys.then((val: any) => {
      progress.report({
        message: "recieved keys from etcd for prefix " + prefix
      });
      for (var key in val) {
        if (cancelToken.isCancellationRequested) {
          console.log("deepInitData: Task Canceled");
          nodeList.updatingNodes = false;
          self.refresh();
          return;
        }
        progress.report({
          message: "loading " + key
        });
        var current_parent = node;
        var currentPrefix = prefix;
        nodeList = node.getChildren();
        isLeaf = false;
        var words = key.split(prefix);
        if (words.length > 1) {
          var tail = words[1];
          if (tail.length > 0) {
            var tailwords = tail.split(separator)
            tailwords.reverse();
            if (tail.startsWith(separator)) {
              tailwords.pop();
            }
            while (tailwords.length > 0) {
              var child;
              var keyw = tailwords.pop();
              if (keyw === undefined)
                continue;
              if (tailwords.length == 0)
                isLeaf = true;
              var pre = "";
              if (currentPrefix.endsWith(separator))
                pre = currentPrefix + keyw;
              else
                pre = currentPrefix + separator + keyw;
              if (nodeList.hasLabel(keyw)) {
                child = nodeList.getNode(keyw);
              }
              else {
                if (!isLeaf) {
                  pre += "/";
                  child = new EtcdNode(keyw, pre, self, current_parent, isLeaf);
                  nodeList.pushNode(child);
                  pre += keyw;
                }
                else {
                  child = new EtcdNode(keyw, pre, self, current_parent, isLeaf, val[key]);
                  nodeList.pushNode(child);
                }
              }
              if (child != undefined) {
                current_parent = child;
                currentPrefix = child.prefix;
                nodeList = child.getChildren();
              }
            }
          }
        }
      }
      nodeList = node.getChildren();
      nodeList.updatingNodes = false;
      node.refreshChildren = false;
      self.refresh();
      console.log("deepInitData => upDating done for " + prefix);
    }, (error: string) => {
      console.log(error);
      vscode.window.showErrorMessage(error.toString());
      nodeList.updatingNodes = false;
      self.refresh();
    });
  }

}
