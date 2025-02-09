import { Plugin } from "obsidian";
import { ChildProcess } from "child_process";
import { AnsiUp } from 'ansi_up';

export class TerminalOutputView {
	private container: HTMLElement;
	private outputElement: HTMLElement;
	private statusElement: HTMLElement;
	private closeButton: HTMLElement;
	private startTime: number;
	private process: ChildProcess;
	private ansiUp: AnsiUp;

	constructor(plugin: Plugin, command: string, process: ChildProcess) {
		this.container = document.createElement("div");
		this.container.classList.add("terminal-output-container");

		const commandElement = document.createElement("pre");
		commandElement.textContent = `Command: ${command}`;
		this.container.appendChild(commandElement);

		this.outputElement = document.createElement("pre");
		this.outputElement.classList.add("terminal-output");
		this.container.appendChild(this.outputElement);

		this.statusElement = document.createElement("div");
		this.statusElement.classList.add("terminal-status");
		this.container.appendChild(this.statusElement);

		this.closeButton = document.createElement("button");
		this.closeButton.textContent = "Close";
		this.closeButton.onclick = () => this.terminateProcess();
		this.container.appendChild(this.closeButton);

		document.body.appendChild(this.container);
		this.startTime = Date.now();
		this.process = process;
		this.ansiUp = new AnsiUp();		

		this.ansiUp.escape_html = true;
		this.ansiUp.url_allowlist = {
			"http": 1,
			"https": 1,
			"mailto": 1,
			"file": 1
		};


	}

	// TODO: Ansiup does not seem to work with htop..
	// https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
	// How about xterm.js

	appendOutput(data: string) {
		const html = this.ansiUp.ansi_to_html(data);
		this.outputElement.innerHTML += html;
		this.outputElement.scrollTop = this.outputElement.scrollHeight;
	}

	setStatus(exitCode: number) {
		const elapsedTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
		const statusDot = document.createElement("span");
		statusDot.classList.add("status-dot");
		statusDot.style.backgroundColor = exitCode === 0 ? "green" : "red";

		this.statusElement.textContent = `Elapsed Time: ${elapsedTime}s `;
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
