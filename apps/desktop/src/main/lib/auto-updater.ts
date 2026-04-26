import { EventEmitter } from "node:events";
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { env } from "main/env.main";
import { setSkipQuitConfirmation } from "main/index";
import { prerelease } from "semver";
import { AUTO_UPDATE_STATUS, type AutoUpdateStatus } from "shared/auto-update";
import { PLATFORM } from "shared/constants";

// electron-updater's internal cache only self-invalidates when the remote
// sha512 differs from cached metadata, so a corrupt cached download (e.g.
// failed Squirrel install) gets retried indefinitely until the user
// manually reinstalls. Reach into the protected helper to clear it.
interface AppUpdaterInternals {
	downloadedUpdateHelper: { clear(): Promise<void> } | null;
}

async function clearCachedUpdate(reason: string): Promise<void> {
	const helper = (autoUpdater as unknown as AppUpdaterInternals)
		.downloadedUpdateHelper;
	if (!helper) return;
	try {
		await helper.clear();
		console.info(`[auto-updater] Cleared cached update (${reason})`);
	} catch (error) {
		console.error("[auto-updater] Failed to clear cached update:", error);
	}
}

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 4; // 4 hours

/**
 * Detect if this is a prerelease build from app version using semver.
 * Versions like "0.0.53-canary" have prerelease component ["canary"].
 * Stable versions like "0.0.53" have no prerelease component.
 */
function isPrereleaseBuild(): boolean {
	const version = app.getVersion();
	const prereleaseComponents = prerelease(version);
	return prereleaseComponents !== null && prereleaseComponents.length > 0;
}

const IS_PRERELEASE = isPrereleaseBuild();
const IS_AUTO_UPDATE_PLATFORM = PLATFORM.IS_MAC || PLATFORM.IS_LINUX;

// Use explicit feed URLs to ensure we always fetch platform-specific manifests
// (for example latest-mac.yml and latest-linux.yml) from the correct release.
// - Stable: fetches from /releases/latest/download/ (latest non-prerelease)
// - Canary: fetches from /releases/download/desktop-canary/ (rolling canary tag)
const UPDATE_FEED_URL = IS_PRERELEASE
	? "https://github.com/superset-sh/superset/releases/download/desktop-canary"
	: "https://github.com/superset-sh/superset/releases/latest/download";

export interface AutoUpdateStatusEvent {
	status: AutoUpdateStatus;
	version?: string;
	error?: string;
}

export const autoUpdateEmitter = new EventEmitter();

// Network errors that don't need to be shown to the user
// These are transient/expected and will resolve on retry
const SILENT_ERROR_PATTERNS = [
	"net::ERR_INTERNET_DISCONNECTED",
	"net::ERR_NETWORK_CHANGED",
	"net::ERR_CONNECTION_REFUSED",
	"net::ERR_NAME_NOT_RESOLVED",
	"net::ERR_CONNECTION_TIMED_OUT",
	"net::ERR_CONNECTION_RESET",
	"ENOTFOUND",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"ECONNRESET",
];

function isNetworkError(error: Error | string): boolean {
	const message = typeof error === "string" ? error : error.message;
	return SILENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

let currentStatus: AutoUpdateStatus = AUTO_UPDATE_STATUS.IDLE;
let currentVersion: string | undefined;
let isDismissed = false;
let isInstalling = false;

function emitStatus(
	status: AutoUpdateStatus,
	version?: string,
	error?: string,
): void {
	currentStatus = status;
	currentVersion = version;

	if (isDismissed && status === AUTO_UPDATE_STATUS.READY) {
		return;
	}

	autoUpdateEmitter.emit("status-changed", { status, version, error });
}

export function getUpdateStatus(): AutoUpdateStatusEvent {
	if (isDismissed && currentStatus === AUTO_UPDATE_STATUS.READY) {
		return { status: AUTO_UPDATE_STATUS.IDLE };
	}
	return { status: currentStatus, version: currentVersion };
}

export function installUpdate(): void {
	console.info("[auto-updater] Install skipped for local build");
	emitStatus(AUTO_UPDATE_STATUS.IDLE);
	return;
}

export function dismissUpdate(): void {
	isDismissed = true;
	autoUpdateEmitter.emit("status-changed", { status: AUTO_UPDATE_STATUS.IDLE });
}

export function checkForUpdates(): void {
	return;
}

export function checkForUpdatesInteractive(): void {
	dialog.showMessageBox({
		type: "info",
		title: "Updates",
		message: "Auto-updates are disabled for local custom builds.",
	});
	return;
}

export function simulateUpdateReady(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	emitStatus(AUTO_UPDATE_STATUS.READY, "99.0.0-test");
}

export function simulateDownloading(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	emitStatus(AUTO_UPDATE_STATUS.DOWNLOADING, "99.0.0-test");
}

export function simulateError(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	emitStatus(
		AUTO_UPDATE_STATUS.ERROR,
		undefined,
		"Simulated error for testing",
	);
}

export function setupAutoUpdater(): void {
	return;
}
