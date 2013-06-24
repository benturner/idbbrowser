/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { interfaces: Ci, utils: Cu } = Components;

const PACKAGE_NAME = "idbbrowser";
const REASON_APP_SHUTDOWN = 2;
const URL_IDBBROWSERHELPER =
  "resource://" + PACKAGE_NAME + "/modules/IDBBrowserHelper.jsm";

const DEBUG = false;

Cu.import("resource://gre/modules/Services.jsm");

function log(msg) {
  msg = "IDBBrowser:bootstrap.js: " + msg;
  Services.console.logStringMessage(msg);
  dump(msg + "\n");
}

function startup(data, reason) {
  if (DEBUG) log("startup: " + reason);

  // Set up the resource substitution.
  let resource =
    Services.io.getProtocolHandler("resource")
            .QueryInterface(Ci.nsIResProtocolHandler);

  let alias = Services.io.newFileURI(data.installPath);
  if (!data.installPath.isDirectory()) {
    alias = Services.io.newURI("jar:" + alias.spec + "!/", null, null);
  }

  resource.setSubstitution(PACKAGE_NAME, alias);

  // Load our helper.
  Cu.import(URL_IDBBROWSERHELPER);

  // And on we go.
  IDBBrowserHelper.startup();
}

function shutdown(data, reason) {
  if (DEBUG) log("shutdown: " + reason);

  // No need to do anything if we're quitting.
  if (reason == REASON_APP_SHUTDOWN) {
    return;
  }

  // Shut down the helper first.
  IDBBrowserHelper.shutdown();
  IDBBrowserHelper = null;
  Cu.unload(URL_IDBBROWSERHELPER);

  // Undo the resource substitution.
  let resource =
    Services.io.getProtocolHandler("resource")
                .QueryInterface(Ci.nsIResProtocolHandler);
  resource.setSubstitution(PACKAGE_NAME, null);
}

function install(data, reason) {
  if (DEBUG) log("install: " + reason);
}

function uninstall(data, reason) {
  if (DEBUG) log("uninstall: " + reason);
}
