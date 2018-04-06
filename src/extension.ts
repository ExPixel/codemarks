"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { createMark, jumpToMark, listMarks, listMarksDelete, clearAllMarks, clearMarksUnderCursor, selectToMark } from "./marks";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const createMarkDisposable = vscode.commands.registerCommand("codemarks.createMark", () => {
        createMark(context);
    });

    const jumpToMarkDisposable = vscode.commands.registerCommand("codemarks.jumpToMark", () => {
        jumpToMark(context);
    });

    const listMarksDisposable = vscode.commands.registerCommand("codemarks.listMarks", () => {
        listMarks(context);
    });

    const listMarksDeleteDisposable = vscode.commands.registerCommand("codemarks.listMarksDelete", () => {
        listMarksDelete(context);
    });

    const clearAllMarksDisposable = vscode.commands.registerCommand("codemarks.clearAllMarks", () => {
        clearAllMarks(context);
    });

    const clearMarksUnderCursorDisposable = vscode.commands.registerCommand("codemarks.clearMarksUnderCursor", () => {
        clearMarksUnderCursor(context);
    });

    const selectToMarkDisposable = vscode.commands.registerCommand("codemarks.selectToMark", () => {
        selectToMark(context);
    });

    context.subscriptions.push(createMarkDisposable);
    context.subscriptions.push(jumpToMarkDisposable);
    context.subscriptions.push(listMarksDisposable);
    context.subscriptions.push(listMarksDeleteDisposable);
    context.subscriptions.push(clearAllMarksDisposable);
    context.subscriptions.push(clearMarksUnderCursorDisposable);
    context.subscriptions.push(selectToMarkDisposable);
}
