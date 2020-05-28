import * as vscode from 'vscode';
import { EtcdExplorerBase, EtcdNode, EtcdSpecialNode, EtcdPagerNode } from "./etcdExplorer"
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
    this.initLevelData(this.RootNode());
    console.log("Done .. nodes");
  }

  getTreeItem(element: EtcdNode): vscode.TreeItem {
    if (element.isLeafNode()) {
      element.command = { command: 'etcd2view.showvalue', title: "Show Value", arguments: [element], };
    }
    return element;
  }

  deleteKeys(prefix: string) {
    this.client.del(prefix, { recursive: true }, console.log);
  }

  initLevelData2(node: EtcdNode) {
    var cs = new vscode.CancellationTokenSource();
    class dummy implements vscode.Progress<{
      message?: string | undefined;
      increment?: number | undefined;
    }> {
      report(value: { message?: string | undefined; increment?: number | undefined; }): void {
      }
    }
    this.deepInitData(node, cs.token, new dummy());
  }

  initLevelData(node: EtcdNode) {
    var prefix = node.prefix;
    var nodeList = node.getChildren();
    var removeList: EtcdNode[] = [];

    // list of elements to remove if they no longer exist
    for (var childNode of nodeList.toArray()) {
      removeList.push(childNode);
    }

    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;

    var isLeaf = false;
    //console.log("initTreeData");

    var self = this;
    this.client.get(prefix, { recursive: false },
      (err: any, val: any) => {
        if (val === undefined) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          nodeList.updatingNodes = false;
          self.refresh();
          return;
        }
        var root = val.node;
        for (var n in root.nodes) {
          console.log(root.nodes[n].key);
          var keyw = root.nodes[n].key.substring(root.nodes[n].key.lastIndexOf(prefix) + prefix.length);
          isLeaf = !root.nodes[n].dir;
          var pre = root.nodes[n].key;
          if (!nodeList.hasLabel(keyw)) {
            if (!isLeaf) {
              pre += separator;
              nodeList.pushLabel(keyw, pre, node, isLeaf);
              //count++;
            }
            else {
              nodeList.pushLabel(keyw, pre, node, isLeaf, root.nodes[n].value);
              //count++;
            }
          }
          else {
            // OK this element still exists and thus need not be removed
            // so remove it from removeList
            removeList.splice(removeList.findIndex((oneOfTheNode) => {
              if (oneOfTheNode.label == keyw) return true;
              return false;
            }), 1);
          }
          nodeList.updatingNodes = false;
          self.refresh();
        }
        // remove elements still in removeList
        for (var nodeToRemove of removeList) {
          nodeList.removeNode(nodeToRemove);
        }
        nodeList.updatingNodes = false;
        self.refresh();
      }
    );
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

    var self = this;
    this.client.get(prefix, { recursive: true },
      (err: any, val: any) => {
        if (val === undefined) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          nodeList.updatingNodes = false;
          self.refresh();
          return;
        }
        progress.report({
          message: "recieved keys from etcd for prefix " + prefix
        });
        var allKeys = [{ key: val.node, val: node }]

        while (allKeys.length > 0) {
          var currentItem = allKeys.pop();
          var currentKey = currentItem?.key;
          var currentNode = currentItem?.val;
          currentNode ? currentNode.refreshChildren = true : null;
          var currentNodeList = currentNode?.getChildren();
          var currentPrefix = currentNode ? currentNode.prefix : separator;
          currentNodeList ? currentNodeList.updatingNodes = true : null;
          for (var childKey of currentKey.nodes) {
            if (cancelToken.isCancellationRequested) {
              console.log("deepInitData: Task Canceled");
              nodeList.updatingNodes = false;
              self.refresh();
              return;
            }
            progress.report({
              message: "loading " + childKey.key
            });

            var keyw = childKey.key.substring(childKey.key.lastIndexOf(currentPrefix) + currentPrefix.length);
            isLeaf = !childKey.dir;
            var pre = childKey.key;
            var childNode: EtcdNode;

            if (!isLeaf) {
              pre += separator;
              childNode = new EtcdNode(keyw, pre, this, currentNode, isLeaf);
              allKeys.push({ key: childKey, val: childNode });
            }
            else {
              childNode = new EtcdNode(keyw, pre, this, currentNode, isLeaf, childKey.value);
            }
            currentNodeList?.pushNode(childNode);
          }
          currentNodeList ? currentNodeList.updatingNodes = false : null;
          currentNode ? currentNode.refreshChildren = false : null;
        }
        nodeList.updatingNodes = false;
        node.refreshChildren = false;
        self.refresh();
      });
  }

}

