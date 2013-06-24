/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const DEBUG = false;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Services", 
  "resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "IDBBrowserHelper", 
  "resource://idbbrowser/modules/IDBBrowserHelper.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils", 
  "resource://gre/modules/FileUtils.jsm");

function log(msg) {
  msg = "IDBBrowser:browser.js: " + msg;
  Services.console.logStringMessage(msg);
  dump(msg + "\n");
}

function IndexMetadata(index) {
  this._name = index.name;
  this._keyPath = JSON.stringify(index.keyPath);
  this._unique = index.unique;
  this._multiEntry = index.multiEntry;
}
IndexMetadata.prototype = {
  get type() {
    return "IDBIndex";
  },
  get name() {
    return this._name;
  },
  get keyPath() {
    return JSON.parse(this._keyPath);
  },
  get unique() {
    return this._unique;
  },
  get multiEntry() {
    return this._multiEntry;
  },
  getDisplay: function() {
    let keyPath = this.keyPath;
    if (typeof(keyPath) != "string" && keyPath !== null) {
      keyPath = "JSON: " + keyPath;
    }
    return {
      type: this.type,
      keyPath: keyPath,
      unique: this.unique,
      multiEntry: this.multiEntry
    };
  }
};

function ObjectStoreMetadata(objectStore) {
  this._name = objectStore.name;
  this._keyPath = JSON.stringify(objectStore.keyPath);
  this._autoIncrement = objectStore.autoIncrement;
  this._indexes = [];

  for (let i = 0; i < objectStore.indexNames.length; i++) {
    let index = objectStore.index(objectStore.indexNames[i]);
    this._indexes.push(new IndexMetadata(index));
  }
}
ObjectStoreMetadata.prototype = {
  get type() {
    return "IDBObjectStore";
  },
  get name() {
    return this._name;
  },
  get keyPath() {
    return JSON.parse(this._keyPath);
  },
  get autoIncrement() {
    return this._autoIncrement;
  },
  get indexes() {
    return this._indexes;
  },
  getDisplay: function() {
    let keyPath = this.keyPath;
    if (typeof(keyPath) != "string" && keyPath !== null) {
      keyPath = "JSON: " + keyPath;
    }
    return {
      type: this.type,
      keyPath: keyPath,
      autoIncrement: this.autoIncrement,
    };
  },
  getIndexMetadata: function(name) {
    for (let i in this._indexes) {
      let indexMetadata = this._indexes[i];
      if (indexMetadata.name == name) {
        return indexMetadata;
      }
    }
    return null;
  }
};

function DatabaseMetadata(origin, db) {
  this._origin = origin;
  this._name = db.name;
  this._version = db.version;
  this._objectStores = [];

  if (db.objectStoreNames.length) {
    let transaction = db.transaction(db.objectStoreNames, "readonly");

    for (let i = 0; i < transaction.objectStoreNames.length; i++) {
      let objectStore =
        transaction.objectStore(transaction.objectStoreNames[i]);
      this._objectStores.push(new ObjectStoreMetadata(objectStore));
    }
  }
};
DatabaseMetadata.prototype = {
  get type() {
    return "IDBDatabase";
  },
  get origin() {
    return this._origin;
  },
  get name() {
    return this._name;
  },
  get version() {
    return this._version;
  },
  get objectStores() {
    return this._objectStores;
  },
  getDisplay: function() {
    return {
      type: this.type,
      version: this.version,
    };
  },
  getObjectStoreMetadata: function(name) {
    for (let i in this._objectStores) {
      let objectStoreMetadata = this._objectStores[i];
      if (objectStoreMetadata.name == name) {
        return objectStoreMetadata;
      }
    }
    return null;
  }
};


function TreeView() {
  this._data = [];
}
TreeView.prototype = {
  _rowCount: 0,
  _selection: null,
  _treeBox: null,
  _data: null,
  _firstDirtyIndex: -1,
  _flushTimeout: null,

  // nsITreeView
  get rowCount() {
    return this._rowCount;
  },

  get selection() {
    return this._selection;
  },
  set selection(val) {
    return this._selection = val;
  },

  getRowProperties: function(index) {
    if (index >= this._data.length) {
      return "loading";
    }
    return null;
  },

  getColumnProperties: function(column) {
    return null;
  },

  getCellProperties: function(index, column) {
    let rowProperties = this.getRowProperties(index);
    let columnProperties = this.getColumnProperties(column);
    if (rowProperties) {
      if (columnProperties) {
        return rowProperties + " " + columnProperties;
      }
      return rowProperties;
    } else if (columnProperties) {
      return columnProperties;
    }
    return null;
  },

  isContainer: function(index) {
    return false;
  },

  isContainerOpen: function(index) {
    return false;
  },

  isContainerEmpty: function(index) {
    return true;
  },

  isSeparator: function(index) {
    return false;
  },

  isSorted: function(index) {
    return false;
  },

  canDrop: function(targetIndex, orientation, dataTransfer) {
    return false;
  },

  drop: function(dropIndex, orientation, dataTransfer) {
  },

  getParentIndex: function(index) {
  },

  hasNextSibling: function(parentIndex, index) {
  },

  getLevel: function(index) {
    return 0;
  },

  getImageSrc: function(index, column) {
    return null;
  },

  getProgressMode: function(index, column) {
    return Ci.nsITreeView.PROGRESS_NONE;
  },

  getCellValue: function(index, column) {
    return this.getCellText(index, column);
  },

  getCellText: function(index, column) {
    if (index >= this._data.length) {
      if (column.index == 0) {
        return "Loading...";
      }
      return "";
    }
    return this._data[index][column.element.getAttribute("anonid")];
  },

  setTree: function(treeBox) {
    this._treeBox = treeBox;
  },

  toggleOpenState: function(index) {
  },

  cycleHeader: function(column) {
  },

  selectionChanged: function() {
  },

  cycleCell: function(index, column) {
  },

  isEditable: function(index, column) {
    return column.editable;
  },

  isSelectable: function(index, column) {
    return column.selectable;
  },

  setCellValue: function(index, column, value) {
  },

  setCellText: function(index, column, text) {
  },

  performAction: function(action) {
  },

  performActionOnRow: function(action, index) {
  },

  performActionOnCell: function(action, index, column) {
  },

  // Not part of nsITreeView.
  get treeBox() {
    return this._treeBox;
  },

  clear: function() {
    let removedCount = this.rowCount * -1;
    this._data = [];
    this._rowCount = 0;
    this.treeBox.rowCountChanged(0, removedCount);
  },

  changeRowCount: function(index, count) {
    this._rowCount += count;
    this.treeBox.rowCountChanged(index, count);
  },

  pushRowData: function(data) {
    let dirtyRowIndex = this._data.length;
    this._data.push(data);

    if (!this._flushTimeout) {
      this._firstDirtyIndex = dirtyRowIndex;
      this._flushTimeout = setTimeout(this.invalidateDirtyRows.bind(this), 100);
    }
  },

  invalidateDirtyRows: function() {
    if (this._flushTimeout) {
      clearTimeout(this._flushTimeout);
      this._flushTimeout = 0;
    }
    if (this._firstDirtyIndex != -1) {
      this.treeBox.invalidateRange(this._firstDirtyIndex,
                                   this._data.length - 1);
      this._firstDirtyIndex = -1;
    }
  }
};

const BrowserController = {
  _stringBundle: null,
  _loadedDatabases: { },
  _currentMetadataRequestSerial: 0,
  _currentDataRequestSerial: 0,
  _dataTreeView: null,
  _lastLoadedTreeCell: null,

  load: function() {
    if (DEBUG) log("onload");

    window.onerror = this._errorHandler.bind(this);

    this._stringBundle = document.getElementById("stringbundle");

    this._dataTreeView = new TreeView();
    document.getElementById("tree-data").view = this._dataTreeView;

    if (!IDBBrowserHelper.supportsOpenWithFile()) {
      document.getElementById("command-open").setAttribute("disabled", "true");
    }

    let fileKey = [ FileUtils.getDir("ProfD", ["indexedDB"]).path ];

    let profileItem = document.getElementById("treechildren-nav").firstChild;
    profileItem.setAttribute("data-file-key", JSON.stringify(fileKey));

    IDBBrowserHelper.getProfileFiles(this._buildProfileFilesTree.bind(this));
  },

  openDatabase: function() {
    if (DEBUG) log("openDatabase");

    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this._stringBundle.getString("openFile-title"),
            Ci.nsIFilePicker.modeOpen);

    fp.appendFilter(this._stringBundle.getString("openFile-filter-title"),
                    "*.sqlite; *.idb");
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    fp.open(function(result) {
      if (result != Ci.nsIFilePicker.returnCancel) {
        this._buildCustomFileTree(fp.file);
      }
    }.bind(this));
  },

  newWindow: function() {
    if (DEBUG) log("newWindow");

    IDBBrowserHelper.openNewBrowser();
  },

  exit: function() {
    if (DEBUG) log("exit");

    window.close();
  },

  handleNavSelect: function(event) {
    if (DEBUG) log("handleNavSelect");

    if (!("view" in event.target)) {
      return;
    }

    this._clearMetadataDisplay();

    let view = event.target.view;

    let rowIndex = view.selection.currentIndex;
    if (rowIndex < 0) {
      return;
    }

    let element = view.getItemAtIndex(rowIndex);

    let [ key, isIDBKey ] = this._getKeyFromElement(element);
    if (!key) {
      return;
    }

    if (key.length < 2) {
      if (DEBUG) log("Bad key: " + JSON.stringify(key));
      return;
    }

    if (key.length == 2) {
      this._handleDatabaseSelect(element, key, isIDBKey);
      return;
    }

    let dbMetadata = this._loadedDatabases[key[0]][key[1]];

    let itemMetadata = dbMetadata.getObjectStoreMetadata(key[2]);
    if (key.length == 4) {
      itemMetadata = itemMetadata.getIndexMetadata(key[3]);
    }

    this._populateMetadataDisplay(itemMetadata.getDisplay(), true);
  },

  handleLoadClick: function(event) {
    if (DEBUG) log("handleLoadClick");

    let navTreeView = document.getElementById("tree-nav").view;

    let rowIndex = navTreeView.selection.currentIndex;
    if (rowIndex < 0) {
      return;
    }

    let element = navTreeView.getItemAtIndex(rowIndex);

    let [ key, isIDBKey ] = this._getKeyFromElement(element);
    if (!key) {
      return;
    }

    if (key.length < 3) {
      if (DEBUG) log("Bad key: " + JSON.stringify(key));
      return;
    }

    this._populateDataTree(key, isIDBKey);

    if (this._lastLoadedTreeCell) {
      let properties = this._lastLoadedTreeCell.getAttribute("properties");
      properties = properties.replace("displayed", "");
      this._lastLoadedTreeCell.setAttribute("properties", properties);
    }

    let treecell = element.firstChild.firstChild;
    let properties = treecell.getAttribute("properties");
    treecell.setAttribute("properties", properties + " displayed");

    this._lastLoadedTreeCell = treecell;
  },

  _getKeyFromElement: function(element) {
    let isIDBKey;
    let key;
    if (element.hasAttribute("data-idb-key")) {
      isIDBKey = true;
      key = element.getAttribute("data-idb-key");
    } else if (element.hasAttribute("data-file-key")) {
      isIDBKey = false;
      key = element.getAttribute("data-file-key");
    } else {
      return [];
    }
    return [ JSON.parse(key), isIDBKey ];
  },

  _errorHandler: function(message, filename, lineNumber) {
    alert("Error: '" + message + "' (" + filename + ":" + lineNumber + ")");
  },

  _buildProfileFilesTree: function(infoPairs) {
    if (DEBUG) log("_buildProfileFilesTree");

    if (!infoPairs.length) {
      let statusElement = document.getElementById("treecell-status");
      let label = this._stringBundle.getString("nav-tree.no-files");
      statusElement.setAttribute("label", label);
      return;
    }

    let profileElement = document.getElementById("treechildren-profile");
    while (profileElement.firstChild) {
      profileElement.removeChild(profileElement.firstChild);
    }

    let originItems = [];

    let currentOrigin;
    let currentChildrenElement;

    for (let i in infoPairs) {
      let infoPair = infoPairs[i];
      let idbKey = [ infoPair.origin, infoPair.name ];

      if (infoPair.origin != currentOrigin) {
        let item = document.createElement("treeitem");
        item.setAttribute("container", "true");
        originItems.push(item);

        let row = document.createElement("treerow");
        item.appendChild(row);

        let cell = document.createElement("treecell");
        cell.setAttribute("label", infoPair.origin);
        cell.setAttribute("properties", "origin");
        row.appendChild(cell);

        let children = document.createElement("treechildren");
        item.appendChild(children);

        currentOrigin = infoPair.origin;
        currentChildrenElement = children;
      }

      let item = document.createElement("treeitem");
      item.setAttribute("data-idb-key", JSON.stringify(idbKey));
      currentChildrenElement.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", infoPair.name);
      cell.setAttribute("properties", "database unloaded");
      row.appendChild(cell);
    }

    for (let i in originItems) {
      profileElement.appendChild(originItems[i]);
    }
  },

  _clearMetadataDisplay: function() {
    if (DEBUG) log("_clearMetadataDisplay");

    let listElement = document.getElementById("listbox-metadata");
    listElement.setAttribute("disabled", "true");

    let loadButton = document.getElementById("button-load");
    loadButton.setAttribute("disabled", "true");

    while (listElement.getRowCount()) {
      listElement.removeItemAt(0);
    }
  },

  _populateMetadataDisplay: function(metadata, loadable) {
    if (DEBUG) log("_populateMetadataDisplay");

    let listElement = document.getElementById("listbox-metadata");

    for (let key in metadata) {
      let row = document.createElement("listitem");

      let cell = document.createElement("listcell");
      cell.setAttribute("label", key);
      cell.setAttribute("value", key);

      row.appendChild(cell);

      cell = document.createElement("listcell");
      cell.setAttribute("label", metadata[key]);
      cell.setAttribute("value", metadata[key]);

      row.appendChild(cell);

      listElement.appendChild(row);
    }

    listElement.removeAttribute("disabled");

    if (loadable) {
      let loadButton = document.getElementById("button-load");
      loadButton.removeAttribute("disabled");
    }
  },

  _handleDatabaseSelect: function(treeItemElement, key, isIDBKey) {
    if (DEBUG) log("_handleDatabaseSelect");

    if ((key[0] in this._loadedDatabases) &&
        (key[1] in this._loadedDatabases[key[0]])) {
      let dbData = this._loadedDatabases[key[0]][key[1]];
      this._populateMetadataDisplay(dbData.getDisplay(), false);
      return;
    }

    let requestSerial = ++this._currentMetadataRequestSerial;

    let request = isIDBKey ?
                  IDBBrowserHelper.openWithOrigin(key[0], key[1]) :
                  IDBBrowserHelper.openWithFile(key[0], key[1]);
    request.onsuccess = function(event) {
      let db = event.target.result;

      let dbData = new DatabaseMetadata(key[0], db);
      db.close();

      if (!(key[0] in this._loadedDatabases)) {
        this._loadedDatabases[key[0]] = {};
      }
      this._loadedDatabases[key[0]][key[1]] = dbData;

      this._buildDatabaseTree(treeItemElement, dbData, key, isIDBKey);

      if (this._currentMetadataRequestSerial == requestSerial) {
        this._populateMetadataDisplay(dbData.getDisplay(), false);
      }
    }.bind(this);
  },

  _buildDatabaseTree: function(treeItemElement, dbData, key, isIDBKey) {
    if (DEBUG) log("_buildDatabaseTree");

    // First update style on treecell.
    let treecell = treeItemElement.firstChild.firstChild;
    let properties = treecell.getAttribute("properties");
    treecell.setAttribute("properties", properties.replace("unloaded", ""));

    if (!dbData.objectStores.length) {
      return;
    }

    treeItemElement.setAttribute("container", "true");
    treeItemElement.setAttribute("open", "true");

    let dbChildren = document.createElement("treechildren");

    for (let i in dbData.objectStores) {
      let osData = dbData.objectStores[i];
      let idbKey = JSON.stringify([ key[0], key[1], osData.name ]);
      let hasIndexes = !!osData.indexes.length;

      let item = document.createElement("treeitem");
      item.setAttribute(isIDBKey ? "data-idb-key" : "data-file-key", idbKey);
      if (hasIndexes) {
        item.setAttribute("container", "true");
      }
      dbChildren.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", osData.name);
      cell.setAttribute("properties", "objectStore");
      row.appendChild(cell);

      if (hasIndexes) {
        let objectStoreChildren = document.createElement("treechildren");
        item.appendChild(objectStoreChildren);

        for (let j in osData.indexes) {
          let idxData = osData.indexes[j];
          let idbKey =
            JSON.stringify([ key[0], key[1], osData.name, idxData.name ]);

          let item = document.createElement("treeitem");
          item.setAttribute(isIDBKey ? "data-idb-key" : "data-file-key",
                            idbKey);
          objectStoreChildren.appendChild(item);

          let row = document.createElement("treerow");
          item.appendChild(row);

          let cell = document.createElement("treecell");
          cell.setAttribute("label", idxData.name);
          cell.setAttribute("properties", "index");
          row.appendChild(cell);
        }
      }
    }

    treeItemElement.appendChild(dbChildren);
  },

  _populateDataTree: function(key, isIDBKey) {
    if (DEBUG) log("_populateDataTree");

    const textSeparator = "   \xBB   ";

    let isIndex = key.length > 3;

    let idbURL = isIDBKey ?
                 key[0] + textSeparator + key[1] + textSeparator + key[2] :
                 key[1] + textSeparator + key[2];

    if (isIndex) {
      idbURL += textSeparator + key[3];
    }

    let dataTree = document.getElementById("tree-data");
    dataTree.removeAttribute("disabled");

    let dataDesc = document.getElementById("description-data");
    dataDesc.setAttribute("value", idbURL);

    let rowCountDesc = document.getElementById("description-rowCount");
    rowCountDesc.setAttribute("value", "");

    let treeView = this._dataTreeView;
    treeView.clear();

    let primaryKeyCol = document.getElementById("treecol-primaryKey");
    if (isIndex) {
      primaryKeyCol.removeAttribute("hidden");
    } else {
      primaryKeyCol.setAttribute("hidden", "true");
    }

    let objectStoreName = key[2];
    let indexName = isIndex ? key[3] : null;

    let requestSerial = ++this._currentDataRequestSerial;

    let request = isIDBKey ?
                  IDBBrowserHelper.openWithOrigin(key[0], key[1]) :
                  IDBBrowserHelper.openWithFile(key[0], key[1]);
    request.onsuccess = function(event) {
      let db = event.target.result;

      if (this._currentDataRequestSerial != requestSerial) {
        db.close();
        return;
      }

      let transaction = db.transaction(objectStoreName, "readonly");

      let source = transaction.objectStore(objectStoreName);
      if (isIndex) {
        source = source.index(indexName);
      }

      source.count().onsuccess = function (event) {
        if (this._currentDataRequestSerial != requestSerial) {
          db.close();
          return;
        }

        let count = event.target.result;

        rowCountDesc.setAttribute("value", count);

        if (count) {
          treeView.changeRowCount(0, count);
        }
      }.bind(this);

      source.openCursor().onsuccess = function(event) {
        let cursor = event.target.result;

        if (this._currentDataRequestSerial != requestSerial) {
          db.close();
          return;
        }

        if (!cursor) {
          treeView.invalidateDirtyRows();
          db.close();
          return;
        }

        let data = isIndex ?
                    [ IDBBrowserHelper.keyToDisplayText(cursor.key),
                      IDBBrowserHelper.keyToDisplayText(cursor.primaryKey),
                      IDBBrowserHelper.valueToDisplayText(cursor.value) ] :
                    [ IDBBrowserHelper.keyToDisplayText(cursor.key),
                      undefined,
                      IDBBrowserHelper.valueToDisplayText(cursor.value) ];
        treeView.pushRowData(data);

        cursor.continue();
      }.bind(this);
    }.bind(this);
  },

  _buildCustomFileTree: function(file) {
    if (DEBUG) log("_buildCustomFileTree");

    let navTreeChildren = document.getElementById("treechildren-nav");
    let navTreeItems = navTreeChildren.children;

    let targetTreeChildren = navTreeChildren;

    for (let i = 0; i < navTreeItems.length; i++) {
      let item = navTreeItems[i];
      if (!item.hasAttribute("data-file-key")) {
        continue;
      }
      let fileKey = JSON.parse(item.getAttribute("data-file-key"));

      if (fileKey[0] == file.parent.path) {
        // Found directory already.
        targetTreeChildren = item.firstChild.nextElementSibling;
        break;
      }
    }

    if (targetTreeChildren == navTreeChildren) {
      // Didn't find directory, make a new one.
      let item = document.createElement("treeitem");
      item.setAttribute("data-file-key", JSON.stringify([ file.parent.path ]));
      item.setAttribute("container", "true");
      item.setAttribute("open", "true");

      targetTreeChildren.appendChild(item);

      let row = document.createElement("treerow");
      item.appendChild(row);

      let cell = document.createElement("treecell");
      cell.setAttribute("label", file.parent.leafName);
      cell.setAttribute("properties", "folder");
      row.appendChild(cell);

      targetTreeChildren = document.createElement("treechildren");
      item.appendChild(targetTreeChildren);
    }

    let fileKey = [ file.parent.path, file.leafName ];

    let item = document.createElement("treeitem");
    item.setAttribute("data-file-key", JSON.stringify(fileKey));
    targetTreeChildren.appendChild(item);

    let row = document.createElement("treerow");
    item.appendChild(row);

    let cell = document.createElement("treecell");
    cell.setAttribute("label", file.leafName);
    cell.setAttribute("properties", "database unloaded");
    row.appendChild(cell);
  }
};
