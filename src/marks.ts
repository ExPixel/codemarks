import * as vscode from "vscode";
import * as Path from "path";

export interface ITypeArguments {
    text: string;
}

export interface IMark {
    line: number;
    column: number;
}

export interface ILocalMark {
    name: string;
    line: number;
    column: number;
}

export interface IGlobalMark {
    document: vscode.TextDocument;
    name: string;
    line: number;
    column: number;
}

export interface ISavedGlobalMark {
    filename: string;
    name: string;
    line: number;
    column: number;
}

export interface IAnyMark {
    name: string;
    filename: string;
    line: number;
    column: number;
    isGlobal: boolean;
    document?: vscode.TextDocument;

    label: string;
    description: string;
    detail: string;
}

/**
 * returns true if the mark was changed.
 */
function applyChangeToMark(mark: IMark, event: vscode.TextDocumentContentChangeEvent): boolean {
    const range = event.range;
    const rel = getMarkRelativity(mark, range);

    if (rel === 0) {
        const lines = event.text.split("\n");
        const multiline = lines.length > 1;

        if (multiline) {
            mark.line = range.start.line + lines.length - 1;
            mark.column = range.end.character + lines[lines.length - 1].length;
        } else {
            mark.line = range.start.line;
            mark.column = range.start.character + lines[lines.length - 1].length;
        }
        return true;
    } else if (rel === 1) {
        const lines = event.text.split("\n");
        const multiline = lines.length > 1;
        if (range.end.line === mark.line) {
            const lastLine = lines[lines.length - 1];
            if (multiline) {
                mark.column += lastLine.length - range.end.character;
            } else {
                mark.column += lastLine.length - (range.end.character - range.start.character);
            }
        }
        mark.line += lines.length - (range.end.line - range.start.line) - 1;
        return true;
    }
    return false;
}

/*
 * Calcultes the relative position of a mark to a range.
 * Returns -1 if the mark is before the change, 1 if the mark is after
 * the change, and 0 if the mark is inside of the change range.
 */
function getMarkRelativity(mark: IMark, range: vscode.Range): number {
    if (mark.line > range.end.line) { return 1; }
    if (mark.line < range.start.line) { return -1; }

    if (mark.line === range.end.line) {
        if (mark.column < range.start.character) { return -1; }
        if (mark.column >= range.end.character) { return 1; }
    }

    return 0;
}

export class MarkHandler implements vscode.Disposable {
    private localMarks: Map<vscode.TextDocument, ILocalMark[]> = new Map();
    private globalMarks: IGlobalMark[] = [];
    private closedGlobalMarks: ISavedGlobalMark[] = [];

    private textEditorCloseListener: vscode.Disposable | null = null;
    private textEditorChangeListener: vscode.Disposable | null = null;
    private activeEditorChangeListener: vscode.Disposable | null = null;
    private textEditorOpenedListener: vscode.Disposable | null = null;
    private configurationChangeListener: vscode.Disposable | null = null;

    private localMarkDecorationType!: vscode.TextEditorDecorationType;
    private globalMarkDecorationType!: vscode.TextEditorDecorationType;

    constructor() {
        this.init();
    }

    private init() {
        this.textEditorCloseListener = vscode.workspace.onDidCloseTextDocument((e) => {
            this.localMarks.delete(e); // remove the local marks and local document references
            this.globalMarks = this.globalMarks.filter((mark) => {
                if (mark.document === e) {
                    if (!e.isUntitled) {
                        const closedMark: ISavedGlobalMark = {
                            filename: Path.resolve(e.fileName),
                            name: mark.name,
                            line: mark.line,
                            column: mark.column,
                        };
                        this.closedGlobalMarks.push(closedMark);
                    }
                    return false;
                } else {
                    return true;
                }
            });
        });

        this.textEditorChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
            // unfortunately I can't just have dirty be set to true only if a mark
            // changes position as I did originally because it causes some issues
            // with expanding decorations when characters are written to the right
            // of one.
            let dirty = false;

            for (const [document, marks] of this.localMarks.entries()) {
                if (e.document === document) {
                    dirty = true;
                    for (const change of e.contentChanges) {
                        for (const mark of marks) {
                            applyChangeToMark(mark, change);
                        }
                    }
                }
            }

            for (const globalMark of this.globalMarks) {
                if (globalMark.document === e.document) {
                    dirty = true;
                    for (const change of e.contentChanges) {
                        applyChangeToMark(globalMark, change);
                    }
                }
            }

            if (dirty && vscode.window.activeTextEditor) {
                this.updateDecorations(vscode.window.activeTextEditor);
            }
        });

        this.textEditorOpenedListener = vscode.workspace.onDidOpenTextDocument((e) => {
            const docFilename = Path.resolve(e.fileName);
            const foundIndex = this.closedGlobalMarks.findIndex((c) => c.filename === docFilename);
            if (foundIndex >= 0) {
                const savedMark = this.closedGlobalMarks[foundIndex];
                this.closedGlobalMarks.splice(foundIndex, 1);
                this.globalMarks.push({
                    name: savedMark.name,
                    document: e,
                    line: savedMark.line,
                    column: savedMark.column,
                });
            }
        });

        this.activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor((e) => {
            if (e) {
                this.updateDecorations(e);
            }
        });

        this.configurationChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("codemarks")) {
                this.reinitMarkColors();
            }
        });

        const localMarkColor: string = vscode.workspace.getConfiguration("codemarks")
            .get<string>("localMarkColor", "#37b24d");
        const globalMarkColor: string = vscode.workspace.getConfiguration("codemarks")
            .get<string>("globalMarkColor", "#f59f00");

        this.localMarkDecorationType = vscode.window.createTextEditorDecorationType({
            borderWidth: "0px 0px 2px 0px",
            borderStyle: "solid",
            borderColor: localMarkColor,
        });

        this.globalMarkDecorationType = vscode.window.createTextEditorDecorationType({
            borderWidth: "0px 0px 2px 0px",
            borderStyle: "solid",
            borderColor: globalMarkColor,
        });
    }

    public dispose() {
        if (this.textEditorCloseListener) {
            this.textEditorCloseListener.dispose();
            this.textEditorCloseListener = null;
        }

        if (this.textEditorChangeListener) {
            this.textEditorChangeListener.dispose();
            this.textEditorChangeListener = null;
        }

        if (this.activeEditorChangeListener) {
            this.activeEditorChangeListener.dispose();
            this.activeEditorChangeListener = null;
        }

        if (this.textEditorOpenedListener) {
            this.textEditorOpenedListener.dispose();
            this.textEditorOpenedListener = null;
        }

        if (this.configurationChangeListener) {
            this.configurationChangeListener.dispose();
            this.configurationChangeListener = null;
        }

        this.localMarkDecorationType.dispose();
        this.globalMarkDecorationType.dispose();
    }

    private reinitMarkColors() {
        this.localMarkDecorationType.dispose();
        this.globalMarkDecorationType.dispose();

        const localMarkColor: string = vscode.workspace.getConfiguration("codemarks")
            .get<string>("localMarkColor", "#37b24d");
        const globalMarkColor: string = vscode.workspace.getConfiguration("codemarks")
            .get<string>("globalMarkColor", "#f59f00");

        this.localMarkDecorationType = vscode.window.createTextEditorDecorationType({
            borderWidth: "0px 0px 2px 0px",
            borderStyle: "solid",
            borderColor: localMarkColor,
        });

        this.globalMarkDecorationType = vscode.window.createTextEditorDecorationType({
            borderWidth: "0px 0px 2px 0px",
            borderStyle: "solid",
            borderColor: globalMarkColor,
        });
    }

    private updateDecorations(editor: vscode.TextEditor) {
        const document = editor.document;
        const localMarkDecorations: vscode.DecorationOptions[] = [];
        const globalMarkDecorations: vscode.DecorationOptions[] = [];

        for (const [mdoc, marks] of this.localMarks.entries()) {
            if (mdoc !== document) { continue; }
            marks.forEach((mark) => {
                const start = new vscode.Position(mark.line, mark.column);
                const end = start.translate(0, 1);
                const options: vscode.DecorationOptions = {
                    range: new vscode.Range(start, end),
                    hoverMessage: "Local Mark `" + mark.name + "`",
                };
                localMarkDecorations.push(options);
            });
        }

        for (const gmark of this.globalMarks) {
            if (gmark.document !== document) { continue; }
            const start = new vscode.Position(gmark.line, gmark.column);
            const end = start.translate(0, 1);
            const options: vscode.DecorationOptions = {
                range: new vscode.Range(start, end),
                hoverMessage: "Global Mark `" + gmark.name + "`",
            };
            globalMarkDecorations.push(options);
        }

        editor.setDecorations(this.localMarkDecorationType, localMarkDecorations);
        editor.setDecorations(this.globalMarkDecorationType, globalMarkDecorations);
    }

    public createEditorMark(markName: string, editor: vscode.TextEditor) {
        const document = editor.document;
        let marks = this.localMarks.get(document);
        let isClear = false;
        if (!marks) {
            marks = [];
            this.localMarks.set(document, marks);
        } else {
            const foundIndex = marks.findIndex((m) => m.name === markName);
            if (foundIndex >= 0) {
                const removing = marks[foundIndex];
                isClear = removing.line === editor.selection.active.line &&
                    removing.column === editor.selection.active.character;
                marks.splice(foundIndex, 1);
            }
        }

        if (!isClear) {
            const localMark: ILocalMark = {
                name: markName,
                line: editor.selection.active.line,
                column: editor.selection.active.character,
            };
            marks.push(localMark);
        }

        if (editor === vscode.window.activeTextEditor) {
            this.updateDecorations(editor);
        }
    }

    public createGlobalMark(markName: string, editor: vscode.TextEditor) {
        const foundIndex = this.globalMarks.findIndex((m) => m.name === markName);
        let isClear = false;
        if (foundIndex >= 0) {
            const removing = this.globalMarks[foundIndex];
            isClear = removing.line === editor.selection.active.line &&
                removing.column === editor.selection.active.character;
            this.globalMarks.splice(foundIndex, 1);
        }

        if (!isClear) {
            const globalMark: IGlobalMark = {
                document: editor.document,
                name: markName,
                line: editor.selection.active.line,
                column: editor.selection.active.character,
            };
            this.globalMarks.push(globalMark);
        }

        if (editor === vscode.window.activeTextEditor) {
            this.updateDecorations(editor);
        }
    }

    public async jumpToLocalMark(markName: string, editor: vscode.TextEditor) {
        let mark: ILocalMark | null = null;
        let document: vscode.TextDocument | null = null;

        for (const [doc, marks] of this.localMarks.entries()) {
            if (doc !== editor.document) { continue; }
            for (const m of marks) {
                if (m.name === markName) {
                    mark = m;
                    document = doc;
                    break;
                }
            }
            if (mark && document) { break; }
        }
        if (!mark || !document) { return; }

        await this.jumpToMark(mark, document);
    }

    public async jumpToGlobalMark(markName: string) {
        let mark: IGlobalMark | null = null;
        for (const globalMark of this.globalMarks) {
            if (globalMark.name === markName) {
                mark = globalMark;
                break;
            }
        }

        if (!mark) {
            this.jumpToSavedGlobalMark(markName);
            return;
        }

        await this.jumpToMark(mark, mark.document);
    }

    private async jumpToSavedGlobalMark(markName: string) {
        let mark: ISavedGlobalMark | null = null;
        for (const savedMark of this.closedGlobalMarks) {
            if (savedMark.name === markName) {
                mark = savedMark;
                break;
            }
        }
        if (!mark) { return; }

        const document = await vscode.workspace.openTextDocument(mark.filename);
        await this.jumpToMark(mark, document);
    }

    private async jumpToMark(mark: IMark, document: vscode.TextDocument) {
        await vscode.window.showTextDocument(document);
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document) {
            const markPosition = new vscode.Position(mark.line, mark.column);
            const selection = new vscode.Selection(markPosition, markPosition);
            vscode.window.activeTextEditor.selection = selection;
        }
    }

    public async jumpToAnyMark(anyMark: IAnyMark) {
        if (anyMark.isGlobal) {
            this.jumpToGlobalMark(anyMark.name);
        } else if (anyMark.document && !anyMark.document.isClosed) {
            this.jumpToMark(anyMark, anyMark.document);
        }
    }

    public deleteAnyMark(anyMark: IAnyMark) {
        if (anyMark.isGlobal) {
            const gindex = this.globalMarks.findIndex((m) => m.name === anyMark.name);
            const cindex = this.closedGlobalMarks.findIndex((m) => m.name === anyMark.name);

            if (gindex >= 0) { this.globalMarks.splice(gindex, 1); }
            if (cindex >= 0) { this.closedGlobalMarks.splice(gindex, 1); }
        } else if (anyMark.document) {
            this.localMarks.delete(anyMark.document);
        }

        // #FIXME I don't always have to do this but, eh, this is fine for now.
        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }

    public clearAllMarks() {
        this.localMarks.clear();
        this.globalMarks = [];
        this.closedGlobalMarks = [];

        // #FIXME I only need to do this if something was deleted.
        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }

    public getMarksList(): IAnyMark[] {
        const list: IAnyMark[] = [];

        for (const [document, marks] of this.localMarks.entries()) {
            for (const mark of marks) {
                list.push({
                    name: mark.name,
                    filename: document.fileName,
                    line: mark.line,
                    column: mark.column,
                    isGlobal: false,
                    document: document,

                    label: mark.name,
                    description: `${document.fileName}:${mark.line}:${mark.column}`,
                    detail: "Local",
                });
            }
        }

        for (const mark of this.globalMarks) {
            list.push({
                name: mark.name,
                filename: mark.document.fileName,
                line: mark.line,
                column: mark.column,
                isGlobal: true,
                document: mark.document,

                label: mark.name,
                description: `${mark.document.fileName}:${mark.line}:${mark.column}`,
                detail: "Global",
            });
        }

        for (const mark of this.closedGlobalMarks) {
            list.push({
                name: mark.name,
                filename: mark.filename,
                line: mark.line,
                column: mark.column,
                isGlobal: true,

                label: mark.name,
                description: `${mark.filename}:${mark.line}:${mark.column}`,
                detail: "Global (closed)",
            });
        }

        return list.sort((a, b) => {
            if (a.filename === b.filename) { return 0; }
            if (a.filename > b.filename) { return 1; }
            return -1;
        });
    }
}

let markHandler: MarkHandler | null = null;
export function getMarkHandler(): MarkHandler {
    if (markHandler === null) {
        markHandler = new MarkHandler();
    }
    return markHandler;
}

export function disposeMarkHandler() {
    if (markHandler !== null) {
        markHandler.dispose();
        markHandler = null;
    }
}

function internalCreateMark(mark: string) {
    const handler = getMarkHandler();
    if (isLowercaseLetter(mark)) {
        if (vscode.window.activeTextEditor) {
            handler.createEditorMark(mark, vscode.window.activeTextEditor);
        }
    } else if (isUppercaseLetter(mark)) {
        if (vscode.window.activeTextEditor) {
            handler.createGlobalMark(mark, vscode.window.activeTextEditor);
        }
    }
}

function internalJumpToMark(mark: string) {
    const handler = getMarkHandler();
    if (isLowercaseLetter(mark)) {
        if (vscode.window.activeTextEditor) {
            handler.jumpToLocalMark(mark, vscode.window.activeTextEditor);
        }
    } else if (isUppercaseLetter(mark)) {
        handler.jumpToGlobalMark(mark);
    }
}

const CHARCODE_UPPER_A: number = "A".charCodeAt(0);
const CHARCODE_UPPER_Z: number = "Z".charCodeAt(0);
const CHARCODE_LOWER_A: number = "a".charCodeAt(0);
const CHARCODE_LOWER_Z: number = "z".charCodeAt(0);
function isLowercaseLetter(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code >= CHARCODE_LOWER_A && code <= CHARCODE_LOWER_Z;
}

function isUppercaseLetter(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code >= CHARCODE_UPPER_A && code <= CHARCODE_UPPER_Z;
}

export function createMark(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("type", (args: ITypeArguments) => {
        if (args && typeof args.text === "string" && args.text.length >= 1) {
            internalCreateMark(args.text[0]);
        }

        disposable.dispose();
        const index = context.subscriptions.indexOf(disposable);
        if (index >= 0) {
            context.subscriptions.splice(index, 1);
        }
    });

    context.subscriptions.push(disposable);
}

export function jumpToMark(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("type", (args: ITypeArguments) => {
        if (args && typeof args.text === "string" && args.text.length >= 1) {
            internalJumpToMark(args.text[0]);
        }

        disposable.dispose();
        const index = context.subscriptions.indexOf(disposable);
        if (index >= 0) {
            context.subscriptions.splice(index, 1);
        }
    });

    context.subscriptions.push(disposable);
}

export async function listMarks(context: vscode.ExtensionContext) {
    const handler = getMarkHandler();
    const marks = handler.getMarksList();

    const picked = await vscode.window.showQuickPick(marks, {
        matchOnDetail: true,
    });

    if (picked) {
        handler.jumpToAnyMark(picked);
    }
}

export async function listMarksDelete(context: vscode.ExtensionContext) {
    const handler = getMarkHandler();
    const marks = handler.getMarksList();

    const picked = await vscode.window.showQuickPick(marks, {
        matchOnDetail: true,
    });

    if (picked) {
        handler.deleteAnyMark(picked);
    }
}

export async function clearAllMarks(context: vscode.ExtensionContext) {
    const handler = getMarkHandler();
    handler.clearAllMarks();
}
