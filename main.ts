import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import { writeFile, unlink, readFile } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TerminalOutputView } from "./TerminalOutputView";

// import "@xterm/xterm/css/xterm.css";

// // @ts-expect-error, not typed
//const editorView = view.editor.cm as EditorView;

interface MyPluginSettings {
	wslMountPath: string;
	autoDiscoverWSL: boolean;
	blacklistEnabled: boolean;
	blacklist: string[];
	promptBeforeRun: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	wslMountPath: "/mnt",
	autoDiscoverWSL: true,
	blacklistEnabled: true,
	blacklist: ["format", "del", "rmdir", "rm", "shutdown", "reboot", "/etc/passwd"],
	promptBeforeRun: false,
};

const IS_WINDOWS = process.platform === "win32";

function debounce(func: (...args: any[]) => void, wait: number) {
	let timeout: NodeJS.Timeout;
	return function (...args: any[]) {
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(this, args), wait);
	};
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	settingTab: SampleSettingTab;
	debouncedRunCommand: (codeBlock: { language: string; codeBlock: string }) => void;

	async onload() {
		await this.loadSettings();

		if (IS_WINDOWS && this.settings.autoDiscoverWSL) {
			this.autoDiscoverWSLSettings();
		}

		// const ribbonIconEl = this.addRibbonIcon('code', 'Sample Plugin', (evt: MouseEvent) => {
		// 	new Notice('This is a notice!');
		// });
		// ribbonIconEl.addClass('my-plugin-ribbon-class');

		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		this.addCommand({
			id: "run-code-block",
			name: "Run Code Block",
			hotkeys: [
				{
					modifiers: ["Ctrl"],
					key: "R",
				},
			],
			checkCallback: (checking: boolean) => {
				return true;
			},
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const codeBlock = this.getCodeBlockUnderCursor(editor);
				if (codeBlock) {
					this.runCommand(codeBlock);
				} else {
					new Notice("No code block found under cursor.");
				}
			},
		});

		this.debouncedRunCommand = debounce(this.runCommand.bind(this), 350);

		this.settingTab = new SampleSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// this.registerDomEvent(document, "click", (evt: MouseEvent) => {
		// 	console.log("click", evt);
		// });

		this.registerEditorExtension(this.createRunButtonExtension());
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	autoDiscoverWSLSettings() {
		if (!IS_WINDOWS) {
			new ErrorModal(
				this.app,
				"Auto discovery of WSL settings is only supported on Windows."
			).open();
			return;
		}

		const wslConfigPath = join(homedir(), ".wslconfig");
		readFile(wslConfigPath, "utf8", (err, data) => {
			if (err) {
				console.error("Failed to read .wslconfig:", err);
				return;
			}
			const match = data.match(/root\s*=\s*(.*)/);
			if (match) {
				this.settings.wslMountPath = match[1].trim();
				this.settings.autoDiscoverWSL = false;
				this.saveSettings();
				new Notice(
					`WSL mount path auto-discovered: ${this.settings.wslMountPath}`
				);
				new Notice(
					`Disabling WSL Settings auto discovery as it has done its. You may enable it or run manualy in settings if required.`
				);
				this.settingTab.updateWSLMountPath(this.settings.wslMountPath);
			}
		});
	}

	getCodeBlockUnderCursor(
		editor: Editor
	): { language: string; codeBlock: string } | null {
		const cursor = editor.getCursor();
		let startLine = cursor.line;

		// TODO: There must be a better way to get the codeblock using the editor view.

		// Return if cursor is possibly at end of a code block we will go up one.
		// Although this will fail if first line.
		if (cursor.ch >= 0 && cursor.ch <= 3 && editor.getLine(startLine).endsWith("```")) {
			startLine = startLine - 1;
		}

		// Find the start of the code block
		while (startLine > 0 && !editor.getLine(startLine).startsWith("```")) {
			startLine--;
		}

		let endLine = startLine + 1;

		// Find the end of the code block
		while (endLine < editor.lineCount() && !editor.getLine(endLine).endsWith("```")) {
			endLine++;
		}

		//console.log(`Code block start: ${startLine} end: ${endLine}`);
		// let range = editor.getDoc().getRange({ line: startLine, ch: 0 }, { line: endLine, ch: 0 });
		// console.log(range);

		// TODO: Prevent over fetching if between code blocks.

		// Check if we found a valid code block
		if (startLine >= 0 && endLine <= editor.lineCount() && startLine !== endLine) {
			const languageMatch = editor.getLine(startLine).match(/```(\w+)/);
			if (languageMatch) {
				const language = languageMatch[1];
				let codeBlock = "";

				// TODO: Can I get new line type from the editor?
				// TODO: Handle new lines depending on language and platform?
				const newLine = (IS_WINDOWS && (language === "bat" || language === "powershell" || language === "ps1")) ? "\r\n" : "\n";				

				for (let i = startLine + 1; i < endLine; i++) {
					codeBlock += editor.getLine(i) + newLine;
				}

				// Note: Keeping new lines at start so that line numbers match up as expected in the editor as that is helpful if dealing with errors.
				// Remove the last newline(s) or whitespace.
				codeBlock = codeBlock.trimEnd();

				return { language, codeBlock };
			}
		}

		return null;
	}

	formatWindowsPathToWSLPath(windowsPath: string): string {
		// Replace backslashes with forward slashes and convert drive letter to WSL mount path
		return windowsPath
			.replace(/\\/g, "/")
			.replace(
				/^([a-zA-Z]):/,
				(_, drive) =>
					`${this.settings.wslMountPath}/${drive.toLowerCase()}`
			)
			.replace(/^\/\//, "/");
	}

	runCommand({
		language,
		codeBlock,
	}: {
		language: string;
		codeBlock: string;
	}) {
		// TODO: Supported languages filter?

		let blacklistedCommands: string[] = [];
		if (this.settings.blacklistEnabled) {
			blacklistedCommands = this.settings.blacklist.filter((command) =>
				new RegExp(`\\b${command}\\b`).test(codeBlock)
			);
			if (blacklistedCommands.length > 0) {
				new ConfirmationModal(this.app, blacklistedCommands, () => {
					this.executeCommand(language, codeBlock);
				}).open();
			} else {
				this.executeCommand(language, codeBlock);
			}
		} else {
			this.executeCommand(language, codeBlock);
		}
	}

	executeCommand(language: string, codeBlock: string) {
		let tempFilePath = "";
		let command = "";
		let wslPath = "";

		// TODO: Support other languages such as Node, r, python, csharp, php, ruby, perl, go, dart etc.
		// TODO: PHP With composer support.
		// TODO: PHP with sail support.
		// TODO: Container support?
		// TODO: A way to set env variables and working directory?

		if (IS_WINDOWS) {
			switch (language) {
				case "ps1":
				case "powershell":
					tempFilePath = join(tmpdir(), `temp-script.ps1`);
					command = `powershell -File "${tempFilePath}"`;
					break;
				case "bat":
					tempFilePath = join(tmpdir(), `temp-script.bat`);
					command = `"${tempFilePath}"`;
					break;
				case "sh":
				case "bash":
					tempFilePath = join(tmpdir(), `temp-script.sh`);
					wslPath = this.formatWindowsPathToWSLPath(tempFilePath);
					command = `bash "${wslPath}"`;
					break;
				case "wsl":
					tempFilePath = join(tmpdir(), `temp-script.sh`);
					wslPath = this.formatWindowsPathToWSLPath(tempFilePath);
					command = `wsl bash "${wslPath}"`;
					break;
				case "node":
				case "javascript":
				case "js":
					tempFilePath = join(tmpdir(), `temp-script.js`);
					command = `node "${tempFilePath}"`;
					break;
					// TODO: Other things that can run such as bun, deno etc.
				case "typescript":
					tempFilePath = join(tmpdir(), `temp-script.ts`);
					command = `node --import=tsx "${tempFilePath}"`;
					break;
				case "html":
					tempFilePath = join(tmpdir(), `temp-script.html`);
					command = `start "" "${tempFilePath}"`;
					break;
				default:
					new ErrorModal(
						this.app,
						`Unsupported language: ${language}`
					).open();
					return;
			}
		} else {
			switch (language) {
				case "sh":
				case "bash":
					tempFilePath = join(tmpdir(), `temp-script.sh`);
					command = `bash "${tempFilePath}"`;
					break;
				case "html":
					tempFilePath = join(tmpdir(), `temp-script.html`);
					command = `xdg-open "${tempFilePath}"`;
					break;
				default:
					new ErrorModal(
						this.app,
						`Unsupported language: ${language}`
					).open();
					return;
			}
		}

		writeFile(tempFilePath, codeBlock, (writeErr) => {
			if (writeErr) {
				new ErrorModal(
					this.app,
					`Failed to write temp file: ${writeErr.message}`
				).open();
				return;
			}

			if (this.settings.promptBeforeRun) {
				new PromptBeforeRunModal(this.app, language, codeBlock, command, () => {
					this.reallyRunTheCode(command, tempFilePath);
				}).open();
			} else {
				this.reallyRunTheCode(command, tempFilePath);
			}
		});
	}

	private reallyRunTheCode(command: string, tempFilePath: string) {
		const terminalOutputView = new TerminalOutputView(this, command);
	}

	createRunButtonExtension() {
		const plugin = this;

		return ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = this.buildDecorations(update.view);
					}
				}

				buildDecorations(view: EditorView) {
					const builder = new RangeSetBuilder<Decoration>();
					for (let { from, to } of view.visibleRanges) {
						let inCodeBlock = false;
						let codeBlockStart = 0;
						for (let pos = from; pos <= to; ) {
							const line = view.state.doc.lineAt(pos);
							if (line.text.startsWith("```")) {
								inCodeBlock = !inCodeBlock;
								if (inCodeBlock) {
									codeBlockStart = line.from;
								} else {
									const runButton = Decoration.widget({
										widget: new RunButtonWidget(
											plugin,
											view,
											codeBlockStart,
											line.to
										),
										side: 1,
									});
									builder.add(
										codeBlockStart,
										codeBlockStart,
										runButton
									);
								}
							}
							pos = line.to + 1;
						}
					}
					return builder.finish();
				}
			},
			{
				decorations: (v) => v.decorations,
			}
		);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		if (IS_WINDOWS) {
			const frag = document.createDocumentFragment();
			frag.appendChild(
				document.createTextNode("Path where WSL mounts drives")
			);
			frag.appendChild(document.createElement("br"));
			const link = document.createElement("a");
			link.href =
				"https://learn.microsoft.com/en-us/windows/wsl/wsl-config#automount-settings";
			link.textContent = "Learn More";
			link.target = "_blank";
			link.rel = "noopener";
			frag.appendChild(link);

			new Setting(containerEl)
				.setName("WSL Mount Path")
				.setDesc(frag)
				.addText((text) =>
					text
						.setPlaceholder("/mnt")
						.setValue(this.plugin.settings.wslMountPath)
						.onChange(async (value) => {
							this.plugin.settings.wslMountPath = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Auto Discover WSL Settings")
				.setDesc("Automatically discover WSL settings on startup.")
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.autoDiscoverWSL)
						.onChange(async (value) => {
							this.plugin.settings.autoDiscoverWSL = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Run Auto Discovery")
				.setDesc("Manually run the auto discovery of WSL settings.")
				.addButton((button) =>
					button
						.setButtonText("Discover")
						.onClick(() => {
							this.plugin.autoDiscoverWSLSettings();
						})
						.setClass("mod-cta")
				);
		}

		new Setting(containerEl)
			.setName("Command Blacklist")
			.setDesc("Commands that will require confirmation before running.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter commands separated by commas")
					.setValue(this.plugin.settings.blacklist.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.blacklist = value
							.split(",")
							.map((cmd) => cmd.trim());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Prompt Before Run")
			.setDesc("Prompt before running code and show the code and command.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.promptBeforeRun)
					.onChange(async (value) => {
						this.plugin.settings.promptBeforeRun = value;
						await this.plugin.saveSettings();
					})
			);
	}

	updateWSLMountPath(newPath: string) {
		const wslMountPathSetting = this.containerEl.querySelector(
			'input[placeholder="/mnt"]'
		);
		if (wslMountPathSetting) {
			(wslMountPathSetting as HTMLInputElement).value = newPath;
		}
	}
}

class OutputModal extends Modal {
	output: string;

	constructor(app: App, output: string) {
		super(app);
		this.output = output;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("terminal-output");

		const pre = document.createElement("pre");
		pre.textContent = this.output;
		contentEl.appendChild(pre);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ErrorModal extends Modal {
	error: string;

	constructor(app: App, error: string) {
		super(app);
		this.error = error;
		console.error(error);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("selectable-text");
		contentEl.setText(this.error);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RunButtonWidget extends WidgetType {
	constructor(
		private plugin: MyPlugin,
		private view: EditorView,
		private from: number,
		private to: number
	) {
		super();
	}

	toDOM() {
		const button = document.createElement("button");
		button.style.backgroundColor = "transparent";
		button.style.border = "none";
		button.style.boxShadow = "none";
		button.style.cursor = "pointer";
		button.style.padding = "0";
		button.style.margin = "0";

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", "16");
		svg.setAttribute("height", "16");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("fill", "green");
		svg.setAttribute("stroke", "transparent");
		svg.setAttribute("stroke-width", "2");
		svg.setAttribute("stroke-linecap", "round");
		svg.setAttribute("stroke-linejoin", "round");

		const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
		polygon.setAttribute("points", "5 3 19 12 5 21 5 3");

		svg.appendChild(polygon);
		button.appendChild(svg);

		button.onclick = () => {
			const codeBlock = this.plugin.getCodeBlockUnderCursor({
				getCursor: () => ({
					line: this.view.state.doc.lineAt(this.from).number,
					ch: 0,
				}),
				getLine: (line: number) => this.view.state.doc.line(line).text,
				lineCount: () => this.view.state.doc.lines,
			});
			if (codeBlock) {
				this.plugin.debouncedRunCommand(codeBlock);

				// Work around for text being selected if user double clicks.
				this.view.dispatch({
					selection: { anchor: this.from, head: this.from }
				});
			}
		};
		return button;
	}

	ignoreEvent() {
		return false;
	}
}

class ConfirmationModal extends Modal {
	blacklistedCommands: string[];
	onConfirm: () => void;

	constructor(
		app: App,
		blacklistedCommands: string[],
		onConfirm: () => void
	) {
		super(app);
		this.blacklistedCommands = blacklistedCommands;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(
			`The code block contains the following blacklisted commands: ${this.blacklistedCommands.join(
				", "
				)}.`
		);

		const question = document.createElement("h1");
		question.textContent = "Are you sure you want to run it?";
		contentEl.appendChild(question);

		const buttonContainer = document.createElement("div");
		buttonContainer.style.marginTop = "10px";

		const confirmButton = document.createElement("button");
		confirmButton.textContent = "Yes";
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};
		buttonContainer.appendChild(confirmButton);

		const cancelButton = document.createElement("button");
		cancelButton.textContent = "No";
		cancelButton.onclick = () => this.close();
		buttonContainer.appendChild(cancelButton);

		contentEl.appendChild(buttonContainer);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PromptBeforeRunModal extends Modal {
	language: string;
	codeBlock: string;
	command: string;
	onConfirm: () => void;

	constructor(app: App, language: string, codeBlock: string, command: string, onConfirm: () => void) {
		super(app);
		this.language = language;
		this.codeBlock = codeBlock;
		this.command = command;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("prompt-before-run");

		const pre = document.createElement("pre");
		pre.textContent = `Language: ${this.language}\nCommand: ${this.command}\n\nCode:\n${this.codeBlock}`;
		contentEl.appendChild(pre);

		const buttonContainer = document.createElement("div");
		buttonContainer.style.marginTop = "10px";

		const confirmButton = document.createElement("button");
		confirmButton.textContent = "Run";
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};
		buttonContainer.appendChild(confirmButton);

		const cancelButton = document.createElement("button");
		cancelButton.textContent = "Cancel";
		cancelButton.onclick = () => this.close();
		buttonContainer.appendChild(cancelButton);

		contentEl.appendChild(buttonContainer);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
