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
    this.initAllData(this.RootNode(), this.jsonToLevelNodeList);
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

  initAllData(node: EtcdNode, callback: Function, ignoreParentKeys?: boolean, recursive?: boolean) {
    var prefix = node.prefix;
    var removePrefixFromKeys = (ignoreParentKeys != undefined) ? ignoreParentKeys : true;
    var recursion = (recursive != undefined) ? recursive : false;
    var nodeList = node.getChildren();

    if (nodeList.updatingNodes)
      return;
    nodeList.updatingNodes = true;

    var self = this;
    this.client.get(prefix, { recursive: recursion },
      (err: any, val: any) => {
        if (val === undefined) {
          console.log(require('util').inspect(err, true, 10));
          vscode.window.showErrorMessage(err.toString());
          nodeList.updatingNodes = false;
          self.refresh();
          return;
        }
        var jsonObj = Object.create({});
        var obj = jsonObj;
        if (removePrefixFromKeys == false) {
          var parentKeys = prefix.split(separator);
          if (parentKeys.length > 0) {
            for (var pk of parentKeys) {
              if (pk != undefined && pk.length > 0) {
                obj[pk] = Object.create({});
                obj = obj[pk];
              }
            }
          }
        }
        var keyObjs = [{ key: val.node, obj: obj, prefix: prefix }];
        while (keyObjs.length > 0) {
          var keyObj = keyObjs.pop()
          var currentKey = keyObj?.key;
          var currentObj = keyObj?.obj;
          var currentPrefix = keyObj?.prefix
          for (var childKey of currentKey.nodes) {
            var keyw = childKey.key.replace(currentPrefix, "");
            if (childKey.dir) {
              currentObj[keyw] = Object.create({});
              if (recursion == true) {
                keyObjs.push({ key: childKey, obj: currentObj[keyw], prefix: childKey.key + separator });
              }
            }
            else {
              currentObj[keyw] = childKey.value;
            }
          }
        }
        callback(jsonObj, node);
        nodeList.updatingNodes = false;
        self.refresh();
      }
    );
  }

}

