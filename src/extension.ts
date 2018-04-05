"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { createMark, jumpToMark, disposeMarkHandler } from "./marks";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const createMarkDisposable = vscode.commands.registerCommand("codemarks.createMark", () => {
        createMark(context);
    });

    const jumpToMarkDisposable = vscode.commands.registerCommand("codemarks.jumpToMark", () => {
        jumpToMark(context);
    });

    context.subscriptions.push(createMarkDisposable);
    context.subscriptions.push(jumpToMarkDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
    disposeMarkHandler();
}
