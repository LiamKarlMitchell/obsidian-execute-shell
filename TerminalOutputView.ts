import { Plugin } from "obsidian";
import { ChildProcess, spawn } from "child_process";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const IS_WINDOWS = process.platform === "win32";

export class TerminalOutputView {
	private container: HTMLElement;
	private terminal: Terminal;
	private fitAddon: FitAddon;
	private process: ChildProcess;
	private statusElement: HTMLElement;
	private startTime: number;
	private closeButton: HTMLElement;

	constructor(plugin: Plugin, command: string, process: ChildProcess) {
		this.startTime = Date.now();
		this.container = document.createElement("div");
		this.container.classList.add("terminal-output-container");

		// const commandElement = document.createElement("pre");
		// commandElement.textContent = `Command: ${command}`;
		// this.container.appendChild(commandElement);

		const terminalContainer = document.createElement("div");
		terminalContainer.classList.add("terminal-output");
		this.container.appendChild(terminalContainer);

		this.statusElement = document.createElement("div");
		this.statusElement.classList.add("status-element");
		this.container.appendChild(this.statusElement);

		this.closeButton = document.createElement("button");
		this.closeButton.textContent = "Close";
		this.closeButton.style.position = "absolute";
		this.closeButton.style.top = "10px";
		this.closeButton.style.right = "10px";
		this.closeButton.onclick = () => this.terminateProcess();
		this.container.appendChild(this.closeButton);

		document.body.appendChild(this.container);

		this.terminal = new Terminal({
			cursorBlink: true,
			convertEol: IS_WINDOWS, // If Windows, convert \n to \r\n
			disableStdin: false,
			// windowsPty: {
			// 	backend: 'winpty',
			// 	buildNumber: 19045,
			// },
			linkHandler: {
				activate: (event, text, range) => {
					window.open(text, "_blank", "noopener");
				}
			},
		});
		
		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.open(terminalContainer);

		this.process = spawn(command, [], {
			// TODO: A way to set cwd to the note directory
			windowsVerbatimArguments: IS_WINDOWS,
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.stdout.on("data", (data) => {
			this.terminal.write(data);
		});

		this.process.stderr.on("data", (data) => {
			this.terminal.write(data);
		});

		let ended = false;
		this.process.on("close", (exitCode) => {
			this.setStatus(exitCode);
			ended = true;
		});

		let input = "";

		// Handle terminal input and pass it to the process
		this.terminal.onData((data) => {
			if (ended) {
				if (data === "\x03") {
					this.container.remove();
				}
				return;
			}

			if (data === "\x03") {
				// Ctrl+C
				this.terminateProcess();
				ended = true;
			} else {
				// Convert carriage return to newline
				console.log(
					`Data: [${data}] Len: ${data.length} ${data.charCodeAt(0)}`
				);

				// https://medium.com/swlh/local-echo-xterm-js-5210f062377e
				const code = data.charCodeAt(0);
				if (code == 13) {
					// Note: Input does not work nicely yet, need to find how to handle for win/nix and different input modes.
					// E.g. sending /r/n for windows and /n for nix works good but when in nano buffering the input string and sending it when carrage return happens is not good nor is printing extra characters.

					// CR
					// this.terminal.write(input);
					// this.terminal.write("\r\n"); // TODO: Handle differences between prompts and not.
					// this.process.stdin.write(input + "\n");
					// input = "";

					//TODO: Differences in input handling for windows and nix?
					//if (data === "\r") {
					// 	this.process.stdin.write("\r\n");
					// } else {
					// 	this.process.stdin.write(data);
					// }
				} else if (code < 32 || code == 127) {
					// Control
					this.process.stdin?.write(data);
					return;
				} else {
					// Visible
					// this.terminal.write(data);
					// input += data;
					this.process.stdin?.write(data);
				}
			}
		});

		this.terminal.onBinary((data) => {
			this.process.stdin.write(Buffer.from(data, 'binary'));
		});

		window.addEventListener("resize", () => this.fitAddon.fit());

		this.fitAddon.fit(); // Ensure the terminal takes up the full space
		this.terminal.focus();

		this.terminal.onTitleChange((title) => {
			console.log(title);
		});
	}

	setStatus(exitCode: number) {
		const elapsedTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
		const statusDot = document.createElement("span");
		statusDot.classList.add("status-dot");
		statusDot.style.backgroundColor = exitCode === 0 ? "green" : "red";

		this.statusElement.textContent = `Elapsed Time: ${elapsedTime}s Exit Code: ${exitCode}`;
		this.statusElement.appendChild(statusDot);
	}

	terminateProcess() {
		if (this.process) {
			this.process.kill();
			this.setStatus(-1); // Indicate that the process was terminated
		}
		this.container.remove();
	}
}
