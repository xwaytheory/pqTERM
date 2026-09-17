import { execFile, spawn } from 'child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, session, shell } from './host'
import type { IpcMainInvokeEvent } from 'electron'
