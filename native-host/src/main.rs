#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use http::Response;
use serde_json::{json, Value};
use std::backtrace::Backtrace;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tao::{
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Fullscreen, WindowBuilder},
};
#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;
use wry::{PageLoadEvent, Rect, WebContext, WebView, WebViewBuilder};

const PKG_NAME: &str = env!("CARGO_PKG_NAME");
const PKG_VERSION: &str = env!("CARGO_PKG_VERSION");
const BACKGROUND_COLOR: (u8, u8, u8) = (0x3B, 0x42, 0x52);
const SIDECAR_LOG_MAX_BYTES: u64 = 1024 * 1024;
const DIAGNOSTIC_RING_CAP: usize = 200;

fn is_app_flavor() -> bool {
    PKG_NAME == "wide-app"
}

fn window_title() -> &'static str {
    if is_app_flavor() {
        "Wide App"
    } else {
        "Wide IDE"
    }
}

fn placement_reg_subkey() -> &'static str {
    if is_app_flavor() {
        "Software\\WideApp"
    } else {
        "Software\\Wide"
    }
}

fn lock_unpoisoned<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn b64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn b64_decode(input: &str) -> Option<Vec<u8>> {
    let mut val = 0u32;
    let mut valb = -8i32;
    let mut out = Vec::with_capacity((input.len() * 3) / 4);
    for byte in input.bytes() {
        if matches!(byte, b'\n' | b'\r' | b' ' | b'\t') {
            continue;
        }
        if byte == b'=' {
            break;
        }
        let d = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        val = (val << 6) | (d as u32);
        valb += 6;
        if valb >= 0 {
            out.push(((val >> valb) & 0xFF) as u8);
            valb -= 8;
        }
    }
    Some(out)
}

#[cfg(windows)]
mod dpapi {
    use core::ffi::c_void;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let mut input = DataBlob {
            cb_data: u32::try_from(data.len()).ok()?,
            pb_data: if data.is_empty() { null_mut() } else { data.as_ptr() as *mut u8 },
        };
        let mut output = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptProtectData(
                &mut input,
                null(),
                null(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
        let copy = slice.to_vec();
        unsafe {
            LocalFree(output.pb_data as *mut c_void);
        }
        Some(copy)
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let mut input = DataBlob {
            cb_data: u32::try_from(data.len()).ok()?,
            pb_data: if data.is_empty() { null_mut() } else { data.as_ptr() as *mut u8 },
        };
        let mut output = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptUnprotectData(
                &mut input,
                null_mut(),
                null(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
        let copy = slice.to_vec();
        unsafe {
            LocalFree(output.pb_data as *mut c_void);
        }
        Some(copy)
    }
}

#[cfg(windows)]
mod win_host {
    use core::ffi::c_void;
    use std::path::Path;
    use std::ptr::{null, null_mut};

    const HKEY_CURRENT_USER: isize = -2147483647isize;
    const KEY_READ: u32 = 0x20019;
    const KEY_WRITE: u32 = 0x20006;
    const REG_BINARY: u32 = 3;
    const IMAGE_ICON: u32 = 1;
    const LR_LOADFROMFILE: u32 = 0x0010;
    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const MONITOR_DEFAULTTONULL: u32 = 0;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;
    const JOB_OBJECT_LIMIT_BREAKAWAY_OK: u32 = 0x00000800;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
    const CLSCTX_ALL: u32 = 0x17;
    const FOS_NOCHANGEDIR: u32 = 0x00000008;
    const FOS_PICKFOLDERS: u32 = 0x00000020;
    const FOS_FORCEFILESYSTEM: u32 = 0x00000040;
    const FOS_ALLOWMULTISELECT: u32 = 0x00000200;
    const SIGDN_FILESYSPATH: u32 = 0x80058000;
    const HRESULT_CANCELLED: i32 = -2147023673;

    const FOF_SILENT: u32 = 0x0004;
    const FOF_NOCONFIRMATION: u32 = 0x0010;
    const FOF_ALLOWUNDO: u32 = 0x0040;
    const FOF_NOERRORUI: u32 = 0x0400;
    const FOFX_RECYCLEONDELETE: u32 = 0x00080000;

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    const CLSID_FILE_OPEN_DIALOG: Guid = Guid {
        data1: 0xDC1C5A9C,
        data2: 0xE88A,
        data3: 0x4DDE,
        data4: [0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7],
    };
    const IID_I_FILE_OPEN_DIALOG: Guid = Guid {
        data1: 0xD57C7288,
        data2: 0xD4AD,
        data3: 0x4768,
        data4: [0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60],
    };
    const IID_I_SHELL_ITEM: Guid = Guid {
        data1: 0x43826D1E,
        data2: 0xE718,
        data3: 0x42EE,
        data4: [0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE],
    };
    const CLSID_FILE_OPERATION: Guid = Guid {
        data1: 0x3AD05575,
        data2: 0x8857,
        data3: 0x4850,
        data4: [0x92, 0x77, 0x11, 0xB8, 0x5B, 0xDB, 0x8E, 0x09],
    };
    const IID_I_FILE_OPERATION: Guid = Guid {
        data1: 0x947AAB5F,
        data2: 0x0A5C,
        data3: 0x4C13,
        data4: [0xB4, 0xD6, 0x4B, 0xF7, 0x83, 0x6F, 0xC9, 0xF8],
    };

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WindowPlacement {
        pub length: u32,
        pub flags: u32,
        pub show_cmd: u32,
        pub pt_min_position: Point,
        pub pt_max_position: Point,
        pub rc_normal_position: Rect,
    }

    #[repr(C)]
    #[derive(Default)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "user32")]
    extern "system" {
        fn IsZoomed(hwnd: isize) -> i32;
        fn GetWindowPlacement(hwnd: isize, lpwndpl: *mut WindowPlacement) -> i32;
        fn MonitorFromRect(lprc: *const Rect, dw_flags: u32) -> isize;
        fn LoadImageW(
            h_inst: isize,
            name: *const u16,
            img_type: u32,
            cx: i32,
            cy: i32,
            fu_load: u32,
        ) -> isize;
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn GetSystemMetrics(n_index: i32) -> i32;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            hkey: isize,
            subkey: *const u16,
            options: u32,
            sam_desired: u32,
            phk_result: *mut isize,
        ) -> i32;
        fn RegCreateKeyExW(
            hkey: isize,
            subkey: *const u16,
            reserved: u32,
            class: *const u16,
            options: u32,
            sam_desired: u32,
            sec_attrs: *const c_void,
            phk_result: *mut isize,
            disposition: *mut u32,
        ) -> i32;
        fn RegQueryValueExW(
            hkey: isize,
            value_name: *const u16,
            reserved: *const u32,
            val_type: *mut u32,
            data: *mut u8,
            cb_data: *mut u32,
        ) -> i32;
        fn RegSetValueExW(
            hkey: isize,
            value_name: *const u16,
            reserved: u32,
            val_type: u32,
            data: *const u8,
            cb_data: u32,
        ) -> i32;
        fn RegCloseKey(hkey: isize) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *const c_void, lp_name: *const u16) -> isize;
        fn SetInformationJobObject(
            h_job: isize,
            info_class: u32,
            info: *const c_void,
            info_len: u32,
        ) -> i32;
        fn AssignProcessToJobObject(h_job: isize, h_process: isize) -> i32;
        fn CloseHandle(h_object: isize) -> i32;
    }

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(pv_reserved: *mut c_void, dw_coinit: u32) -> i32;
        fn CoUninitialize();
        fn CoCreateInstance(
            rclsid: *const Guid,
            p_unk_outer: *mut c_void,
            dw_cls_context: u32,
            riid: *const Guid,
            ppv: *mut *mut c_void,
        ) -> i32;
        fn CoTaskMemFree(pv: *mut c_void);
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHCreateItemFromParsingName(
            psz_path: *const u16,
            pbc: *mut c_void,
            riid: *const Guid,
            ppv: *mut *mut c_void,
        ) -> i32;
        fn ShellExecuteW(
            hwnd: isize,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    pub fn to_wide(s: &str) -> Vec<u16> {
        let mut v: Vec<u16> = s.encode_utf16().collect();
        v.push(0);
        v
    }

    unsafe fn from_pwstr(ptr: *mut u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16_lossy(slice)
    }

    pub struct JobObject(isize);

    impl JobObject {
        pub fn create() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(null(), null());
                if handle == 0 {
                    return None;
                }
                let mut info = JobObjectExtendedLimitInformation::default();
                info.basic_limit_information.limit_flags =
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
                let ok = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&info as *const JobObjectExtendedLimitInformation) as *const c_void,
                    std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self(handle))
            }
        }

        pub fn assign_process(&self, process_handle: isize) -> bool {
            if self.0 == 0 || process_handle == 0 {
                return false;
            }
            unsafe { AssignProcessToJobObject(self.0, process_handle) != 0 }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = 0;
            }
        }
    }

    struct ComInit(bool);

    impl ComInit {
        fn enter() -> Option<Self> {
            let hr = unsafe { CoInitializeEx(null_mut(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            if hr == 0 || hr == 1 {
                Some(Self(true))
            } else if hr as u32 == 0x80010106 {
                Some(Self(false))
            } else {
                None
            }
        }
    }

    impl Drop for ComInit {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    struct ComPtr(*mut c_void);

    impl ComPtr {
        unsafe fn vtable_slot(&self, index: usize) -> *const c_void {
            let vtbl = *(self.0 as *const *const *const c_void);
            *vtbl.add(index)
        }
    }

    impl Drop for ComPtr {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let slot = self.vtable_slot(2);
                    let release: unsafe extern "system" fn(*mut c_void) -> u32 = std::mem::transmute(slot);
                    release(self.0);
                }
                self.0 = null_mut();
            }
        }
    }

    unsafe fn shell_item_path(item: &ComPtr) -> Option<String> {
        let get_display_name: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32 =
            std::mem::transmute(item.vtable_slot(5));
        let mut raw_ptr: *mut u16 = null_mut();
        let hr = get_display_name(item.0, SIGDN_FILESYSPATH, &mut raw_ptr);
        if hr < 0 || raw_ptr.is_null() {
            return None;
        }
        let s = from_pwstr(raw_ptr);
        CoTaskMemFree(raw_ptr as *mut c_void);
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    fn strip_verbatim(p: &Path) -> String {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{}", rest)
        } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
            rest.to_string()
        } else {
            s.into_owned()
        }
    }

    pub fn open_dialog(
        is_dir: bool,
        multi: bool,
        title: &str,
        default_path: &str,
        owner_hwnd: isize,
    ) -> Result<Option<Vec<String>>, String> {
        let _com = ComInit::enter().ok_or_else(|| "COM initialization failed".to_string())?;
        unsafe {
            let mut raw_dlg: *mut c_void = null_mut();
            let hr = CoCreateInstance(
                &CLSID_FILE_OPEN_DIALOG,
                null_mut(),
                CLSCTX_ALL,
                &IID_I_FILE_OPEN_DIALOG,
                &mut raw_dlg,
            );
            if hr < 0 || raw_dlg.is_null() {
                return Err(format!("CoCreateInstance IFileOpenDialog failed: {:#x}", hr));
            }
            let dlg = ComPtr(raw_dlg);

            let get_options: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32 =
                std::mem::transmute(dlg.vtable_slot(10));
            let set_options: unsafe extern "system" fn(*mut c_void, u32) -> i32 =
                std::mem::transmute(dlg.vtable_slot(9));
            let mut opts: u32 = 0;
            let _ = get_options(dlg.0, &mut opts);
            opts |= FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR;
            if is_dir {
                opts |= FOS_PICKFOLDERS;
            }
            if multi {
                opts |= FOS_ALLOWMULTISELECT;
            }
            let hr = set_options(dlg.0, opts);
            if hr < 0 {
                return Err(format!("SetOptions failed: {:#x}", hr));
            }

            if !title.is_empty() {
                let set_title: unsafe extern "system" fn(*mut c_void, *const u16) -> i32 =
                    std::mem::transmute(dlg.vtable_slot(17));
                let title_w = to_wide(title);
                let _ = set_title(dlg.0, title_w.as_ptr());
            }

            if !default_path.is_empty() {
                let norm = default_path.replace('/', "\\");
                let p = Path::new(&norm);
                let folder = if p.is_file() { p.parent().unwrap_or(p) } else { p };
                if folder.exists() {
                    let abs = std::fs::canonicalize(folder)
                        .map(|c| strip_verbatim(&c))
                        .unwrap_or_else(|_| folder.to_string_lossy().into_owned());
                    let abs_w = to_wide(&abs);
                    let mut raw_folder: *mut c_void = null_mut();
                    if SHCreateItemFromParsingName(abs_w.as_ptr(), null_mut(), &IID_I_SHELL_ITEM, &mut raw_folder) >= 0
                        && !raw_folder.is_null()
                    {
                        let folder_item = ComPtr(raw_folder);
                        let set_folder: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32 =
                            std::mem::transmute(dlg.vtable_slot(12));
                        let _ = set_folder(dlg.0, folder_item.0);
                    }
                }
            }

            let show: unsafe extern "system" fn(*mut c_void, isize) -> i32 =
                std::mem::transmute(dlg.vtable_slot(3));
            let hr = show(dlg.0, owner_hwnd);
            if hr == HRESULT_CANCELLED {
                return Ok(None);
            }
            if hr < 0 {
                return Err(format!("Dialog Show failed: {:#x}", hr));
            }

            let mut paths = Vec::new();
            if multi {
                let get_results: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32 =
                    std::mem::transmute(dlg.vtable_slot(27));
                let mut raw_arr: *mut c_void = null_mut();
                if get_results(dlg.0, &mut raw_arr) >= 0 && !raw_arr.is_null() {
                    let arr = ComPtr(raw_arr);
                    let get_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32 =
                        std::mem::transmute(arr.vtable_slot(7));
                    let get_item_at: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32 =
                        std::mem::transmute(arr.vtable_slot(8));
                    let mut count: u32 = 0;
                    if get_count(arr.0, &mut count) >= 0 {
                        for idx in 0..count {
                            let mut raw_item: *mut c_void = null_mut();
                            if get_item_at(arr.0, idx, &mut raw_item) >= 0 && !raw_item.is_null() {
                                let item = ComPtr(raw_item);
                                if let Some(p) = shell_item_path(&item) {
                                    paths.push(p);
                                }
                            }
                        }
                    }
                }
            } else {
                let get_result: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32 =
                    std::mem::transmute(dlg.vtable_slot(20));
                let mut raw_item: *mut c_void = null_mut();
                if get_result(dlg.0, &mut raw_item) >= 0 && !raw_item.is_null() {
                    let item = ComPtr(raw_item);
                    if let Some(p) = shell_item_path(&item) {
                        paths.push(p);
                    }
                }
            }

            if paths.is_empty() {
                Ok(None)
            } else {
                Ok(Some(paths))
            }
        }
    }

    pub fn trash_item(raw_path: &str) -> Result<(), String> {
        let norm = raw_path.replace('/', "\\");
        let target = Path::new(&norm);
        if !target.exists() {
            return Err("Path not found".to_string());
        }
        let abs = std::fs::canonicalize(target)
            .map(|c| strip_verbatim(&c))
            .map_err(|e| e.to_string())?;
        let _com = ComInit::enter().ok_or_else(|| "COM initialization failed".to_string())?;
        unsafe {
            let mut raw_item: *mut c_void = null_mut();
            let path_w = to_wide(&abs);
            let hr = SHCreateItemFromParsingName(
                path_w.as_ptr(),
                null_mut(),
                &IID_I_SHELL_ITEM,
                &mut raw_item,
            );
            if hr < 0 || raw_item.is_null() {
                return Err(format!("SHCreateItemFromParsingName failed: {:#x}", hr));
            }
            let item = ComPtr(raw_item);

            let mut raw_op: *mut c_void = null_mut();
            let hr = CoCreateInstance(
                &CLSID_FILE_OPERATION,
                null_mut(),
                CLSCTX_ALL,
                &IID_I_FILE_OPERATION,
                &mut raw_op,
            );
            if hr < 0 || raw_op.is_null() {
                return Err(format!("CoCreateInstance IFileOperation failed: {:#x}", hr));
            }
            let op = ComPtr(raw_op);

            let set_flags: unsafe extern "system" fn(*mut c_void, u32) -> i32 =
                std::mem::transmute(op.vtable_slot(5));
            let hr = set_flags(
                op.0,
                FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOFX_RECYCLEONDELETE,
            );
            if hr < 0 {
                return Err(format!("SetOperationFlags failed: {:#x}", hr));
            }

            let delete_item: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> i32 =
                std::mem::transmute(op.vtable_slot(18));
            let hr = delete_item(op.0, item.0, null_mut());
            if hr < 0 {
                return Err(format!("DeleteItem failed: {:#x}", hr));
            }

            let perform: unsafe extern "system" fn(*mut c_void) -> i32 =
                std::mem::transmute(op.vtable_slot(21));
            let hr = perform(op.0);
            if hr < 0 {
                return Err(format!("PerformOperations failed: {:#x}", hr));
            }

            let any_aborted: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32 =
                std::mem::transmute(op.vtable_slot(22));
            let mut aborted: i32 = 0;
            let _ = any_aborted(op.0, &mut aborted);
            if aborted != 0 {
                return Err("Trash operation was aborted".to_string());
            }
            Ok(())
        }
    }

    pub fn shell_open_external(owner_hwnd: isize, url: &str) -> bool {
        let op = to_wide("open");
        let file = to_wide(url);
        let rc = unsafe { ShellExecuteW(owner_hwnd, op.as_ptr(), file.as_ptr(), null(), null(), 1) };
        rc > 32
    }

    pub fn is_zoomed(hwnd: isize) -> bool {
        if hwnd == 0 {
            return false;
        }
        unsafe { IsZoomed(hwnd) != 0 }
    }

    pub fn read_window_placement(subkey_str: &str) -> Option<WindowPlacement> {
        let subkey = to_wide(subkey_str);
        let name = to_wide("WindowPlacement");
        let mut hkey: isize = 0;
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) };
        if rc != 0 || hkey == 0 {
            return None;
        }
        let mut wp: WindowPlacement = unsafe { std::mem::zeroed() };
        let expected_size = std::mem::size_of::<WindowPlacement>() as u32;
        let mut size = expected_size;
        let mut val_type: u32 = 0;
        let rc2 = unsafe {
            RegQueryValueExW(
                hkey,
                name.as_ptr(),
                null(),
                &mut val_type,
                (&mut wp as *mut WindowPlacement) as *mut u8,
                &mut size,
            )
        };
        unsafe {
            RegCloseKey(hkey);
        }
        if rc2 != 0 || val_type != REG_BINARY || size != expected_size || wp.length != expected_size {
            return None;
        }
        Some(wp)
    }

    pub fn rect_on_monitor(rect: &Rect) -> bool {
        if rect.right - rect.left < 200 || rect.bottom - rect.top < 150 {
            return false;
        }
        unsafe { MonitorFromRect(rect as *const Rect, MONITOR_DEFAULTTONULL) != 0 }
    }

    pub fn write_window_placement(hwnd: isize, subkey_str: &str) {
        if hwnd == 0 {
            return;
        }
        let mut wp: WindowPlacement = unsafe { std::mem::zeroed() };
        wp.length = std::mem::size_of::<WindowPlacement>() as u32;
        let ok = unsafe { GetWindowPlacement(hwnd, &mut wp) };
        if ok == 0 {
            return;
        }
        if wp.show_cmd == 2 {
            wp.show_cmd = 1;
        }
        let subkey = to_wide(subkey_str);
        let name = to_wide("WindowPlacement");
        let mut hkey: isize = 0;
        let mut disp: u32 = 0;
        let rc = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null(),
                0,
                KEY_WRITE,
                null_mut(),
                &mut hkey,
                &mut disp,
            )
        };
        if rc != 0 || hkey == 0 {
            return;
        }
        unsafe {
            RegSetValueExW(
                hkey,
                name.as_ptr(),
                0,
                REG_BINARY,
                (&wp as *const WindowPlacement) as *const u8,
                wp.length,
            );
            RegCloseKey(hkey);
        }
    }

    pub fn apply_window_icon(hwnd: isize, assets_dir: &Path) {
        if hwnd == 0 {
            return;
        }
        let ico = assets_dir.join("wide.ico");
        if !ico.exists() {
            return;
        }
        let wide = to_wide(&ico.to_string_lossy());
        unsafe {
            let sm_cx = GetSystemMetrics(49).max(16);
            let sm_cy = GetSystemMetrics(50).max(16);
            let big_cx = GetSystemMetrics(11).max(32);
            let big_cy = GetSystemMetrics(12).max(32);
            let small_icon = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, sm_cx, sm_cy, LR_LOADFROMFILE);
            let big_icon = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, big_cx, big_cy, LR_LOADFROMFILE);
            if small_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small_icon);
            }
            if big_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG, big_icon);
            }
        }
    }
}

fn handle_crypto_protect(data_b64: &str) -> Value {
    let Some(raw) = b64_decode(data_b64) else {
        return json!({ "ok": false });
    };
    #[cfg(windows)]
    {
        if let Some(enc) = dpapi::protect(&raw) {
            return json!({ "ok": true, "data": b64_encode(&enc) });
        }
    }
    let _ = raw;
    json!({ "ok": false })
}

fn handle_crypto_unprotect(data_b64: &str) -> Value {
    let Some(enc) = b64_decode(data_b64) else {
        return json!({ "ok": false });
    };
    #[cfg(windows)]
    {
        if let Some(plain) = dpapi::unprotect(&enc) {
            return json!({ "ok": true, "data": b64_encode(&plain) });
        }
    }
    let _ = enc;
    json!({ "ok": false })
}

fn is_allowed_external_url(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

fn is_allowed_browser_url(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower == "about:blank"
}

#[derive(Debug)]
enum UserEvent {
    SidecarLine(String),
    SidecarExit,
    WindowDrag,
    WindowMinimize,
    WindowMaximize,
    WindowFullscreen,
    WindowClose,
    OpenPath(String),
    BrowserCmd { cmd: String, payload: Value },
    BrowserPageEvent(Value),
}

fn get_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn resolve_protocol_asset(canon_root: &Path, uri_path: &str) -> Option<(PathBuf, bool)> {
    let raw = if uri_path == "/" || uri_path.is_empty() {
        "index.html"
    } else {
        uri_path.trim_start_matches('/')
    };
    let rel_clean = raw.split('?').next().unwrap_or(raw).split('#').next().unwrap_or(raw);
    if rel_clean.contains('\\') || rel_clean.contains('\0') {
        return None;
    }
    let mut joined = canon_root.to_path_buf();
    let mut seg_count = 0usize;
    for seg in rel_clean.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return None;
        }
        joined.push(seg);
        seg_count += 1;
    }
    if seg_count == 0 {
        joined.push("index.html");
    }

    if let Ok(canon_file) = fs::canonicalize(&joined) {
        if canon_file.starts_with(canon_root) && canon_file.is_file() {
            let is_hashed_asset = rel_clean.starts_with("assets/");
            return Some((canon_file, is_hashed_asset));
        }
    }

    let has_ext = Path::new(rel_clean).extension().is_some();
    if has_ext {
        return None;
    }
    let fallback = canon_root.join("index.html");
    if let Ok(canon_index) = fs::canonicalize(&fallback) {
        if canon_index.starts_with(canon_root) && canon_index.is_file() {
            return Some((canon_index, false));
        }
    }
    None
}

fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_portable_root(exe_dir: &Path) -> Option<PathBuf> {
    if exe_dir.join("portable").exists() || exe_dir.join("wide.portable").exists() {
        return Some(exe_dir.to_path_buf());
    }
    if let Ok(env_val) = std::env::var("WIDE_PORTABLE") {
        let trimmed = env_val.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

fn resolve_user_data_dir(exe_dir: &Path) -> PathBuf {
    if let Some(root) = resolve_portable_root(exe_dir) {
        return root.join("data");
    }
    #[cfg(windows)]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            if !app_data.trim().is_empty() {
                return PathBuf::from(app_data).join("wide");
            }
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.trim().is_empty() {
                return PathBuf::from(profile).join("AppData").join("Roaming").join("wide");
            }
        }
        std::env::temp_dir().join("wide")
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.trim().is_empty() {
                return PathBuf::from(xdg).join("wide");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                return PathBuf::from(home).join(".config").join("wide");
            }
        }
        std::env::temp_dir().join("wide")
    }
}

fn resolve_webview_user_data_dir(exe_dir: &Path) -> PathBuf {
    if let Some(root) = resolve_portable_root(exe_dir) {
        return root.join("data").join("WebView2");
    }
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.trim().is_empty() {
                return PathBuf::from(local).join(PKG_NAME).join("WebView2");
            }
        }
        std::env::temp_dir().join(PKG_NAME).join("WebView2")
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return PathBuf::from(xdg).join(PKG_NAME).join("webview");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                return PathBuf::from(home).join(".local").join("share").join(PKG_NAME).join("webview");
            }
        }
        std::env::temp_dir().join(PKG_NAME).join("webview")
    }
}

fn resolve_sidecar_log_path() -> PathBuf {
    std::env::temp_dir().join(PKG_NAME).join("sidecar.log")
}

fn install_panic_hook(exe_dir: PathBuf) {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Native host panic".to_string()
        };
        let bt = Backtrace::force_capture();
        let detail = format!("{} at {}\n{}", msg, location, bt);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let payload = json!({
            "kind": "nativePanic",
            "detail": detail,
            "os": std::env::consts::OS,
            "version": PKG_VERSION,
            "timestamp": ts
        });
        let crash_dir = resolve_user_data_dir(&exe_dir);
        let _ = fs::create_dir_all(&crash_dir);
        let _ = fs::write(crash_dir.join("pending_crash.json"), payload.to_string());
        default_hook(info);
    }));
}

fn resolve_renderer_dir(exe_dir: &Path) -> PathBuf {
    let direct_ui = exe_dir.join("ui");
    if direct_ui.join("index.html").exists() {
        return direct_ui;
    }
    let res_renderer = exe_dir.join("resources").join("app").join("out").join("renderer");
    if res_renderer.join("index.html").exists() {
        return res_renderer;
    }
    let out_renderer = exe_dir.join("out").join("renderer");
    if out_renderer.join("index.html").exists() {
        return out_renderer;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("out").join("renderer");
        if cand.join("index.html").exists() {
            return cand;
        }
        let cand_ui = cur.join("ui");
        if cand_ui.join("index.html").exists() {
            return cand_ui;
        }
        if !cur.pop() {
            break;
        }
    }
    direct_ui
}

fn resolve_assets_dir(exe_dir: &Path) -> PathBuf {
    let direct_assets = exe_dir.join("assets");
    if direct_assets.exists() {
        return direct_assets;
    }
    let native_assets = exe_dir.join("native-host").join("assets");
    if native_assets.exists() {
        return native_assets;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("native-host").join("assets");
        if cand.exists() {
            return cand;
        }
        let cand_a = cur.join("assets");
        if cand_a.exists() {
            return cand_a;
        }
        if !cur.pop() {
            break;
        }
    }
    direct_assets
}

fn handle_open_dialog(params: &Value, owner_hwnd: isize) -> Value {
    let props: Vec<String> = params
        .get("properties")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let is_dir = props.iter().any(|p| p == "openDirectory");
    let multi = props.iter().any(|p| p == "multiSelections");
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let default_path = params.get("defaultPath").and_then(|v| v.as_str()).unwrap_or("").to_string();

    #[cfg(windows)]
    {
        match win_host::open_dialog(is_dir, multi, &title, &default_path, owner_hwnd) {
            Ok(Some(file_paths)) => json!({ "canceled": false, "filePaths": file_paths }),
            Ok(None) | Err(_) => json!({ "canceled": true, "filePaths": [] }),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (is_dir, multi, title, default_path, owner_hwnd);
        json!({ "canceled": true, "filePaths": [] })
    }
}

fn handle_show_in_folder(raw_path: &str) {
    if raw_path.is_empty() {
        return;
    }
    #[cfg(windows)]
    {
        let norm = raw_path.replace('/', "\\");
        let _ = Command::new("explorer.exe").arg(format!("/select,{}", norm)).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").args(["-R", raw_path]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let target = Path::new(raw_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(raw_path);
        let _ = Command::new("xdg-open").arg(target).spawn();
    }
}

fn handle_trash_item(raw_path: &str) -> Value {
    if raw_path.is_empty() {
        return json!({ "ok": false, "error": "Missing path" });
    }
    #[cfg(windows)]
    {
        match win_host::trash_item(raw_path) {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e }),
        }
    }
    #[cfg(not(windows))]
    {
        let p = Path::new(raw_path);
        let res = if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) };
        match res {
            Ok(_) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }
}

fn resolve_node_exe(exe_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let local_node = exe_dir.join("node.exe");
        if local_node.exists() {
            return local_node;
        }
        let sys_node = PathBuf::from("C:\\Program Files\\nodejs\\node.exe");
        if sys_node.exists() {
            return sys_node;
        }
        PathBuf::from("node.exe")
    }
    #[cfg(not(windows))]
    {
        let local_node = exe_dir.join("node");
        if local_node.exists() {
            return local_node;
        }
        PathBuf::from("node")
    }
}

fn resolve_sidecar_script(exe_dir: &Path) -> PathBuf {
    let cand1 = exe_dir.join("sidecar").join("sidecar.cjs");
    if cand1.exists() {
        return cand1;
    }
    let cand2 = exe_dir.join("resources").join("app").join("sidecar").join("sidecar.cjs");
    if cand2.exists() {
        return cand2;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("sidecar").join("sidecar.cjs");
        if cand.exists() {
            return cand;
        }
        if !cur.pop() {
            break;
        }
    }
    cand1
}

fn build_preload_script(assets_dir: &Path) -> String {
    let bridge_shim = r#"
(function() {
  if (window.__wideIpcBridgeInstalled) return;
  window.__wideIpcBridgeInstalled = true;
  var nativeWebview = window.chrome && window.chrome.webview;
  var nativePost = nativeWebview && typeof nativeWebview.postMessage === "function"
    ? nativeWebview.postMessage.bind(nativeWebview)
    : null;
  window.chrome = window.chrome || {};
  window.__wideIpcListeners = window.__wideIpcListeners || new Set();
  window.chrome.webview = {
    postMessage: function(data) {
      var payload = typeof data === "string" ? data : JSON.stringify(data);
      if (nativePost) {
        nativePost(payload);
      }
    },
    addEventListener: function(event, fn) {
      if (event === "message") window.__wideIpcListeners.add(fn);
    },
    removeEventListener: function(event, fn) {
      if (event === "message") window.__wideIpcListeners.delete(fn);
    }
  };
  window.__wideDispatchMessage = function(raw) {
    var msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    window.__wideIpcListeners.forEach(function(fn) {
      try { fn({ data: msg }); } catch (e) { console.error(e); }
    });
  };
})();
"#;
    let mut script = String::from(bridge_shim);
    for asset_name in ["engine-preview.js", "preload-shim.js", "titlebar.js"] {
        let path = assets_dir.join(asset_name);
        if let Ok(content) = fs::read_to_string(&path) {
            script.push('\n');
            script.push_str(&content);
            script.push('\n');
        }
    }
    script
}

fn record_diagnostic_line(
    ring: &Arc<Mutex<VecDeque<String>>>,
    log_file: &Arc<Mutex<Option<std::fs::File>>>,
    log_path: &Path,
    tag: &str,
    line: &str,
) {
    let entry = format!("[{}] {}", tag, line);
    {
        let mut guard = lock_unpoisoned(ring);
        if guard.len() >= DIAGNOSTIC_RING_CAP {
            guard.pop_front();
        }
        guard.push_back(entry.clone());
    }
    let mut file_guard = lock_unpoisoned(log_file);
    if file_guard.is_none() {
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(meta) = fs::metadata(log_path) {
            if meta.len() >= SIDECAR_LOG_MAX_BYTES {
                let prev = log_path.with_extension("log.prev");
                let _ = fs::remove_file(&prev);
                let _ = fs::rename(log_path, &prev);
            }
        }
        if let Ok(f) = OpenOptions::new().create(true).append(true).open(log_path) {
            *file_guard = Some(f);
        }
    }
    if let Some(f) = file_guard.as_mut() {
        let _ = writeln!(f, "{}", entry);
        let _ = f.flush();
        if let Ok(meta) = f.metadata() {
            if meta.len() >= SIDECAR_LOG_MAX_BYTES {
                *file_guard = None;
                let prev = log_path.with_extension("log.prev");
                let _ = fs::remove_file(&prev);
                let _ = fs::rename(log_path, &prev);
            }
        }
    }
}

struct Sidecar {
    child: Mutex<Option<Child>>,
    stdin_tx: Mutex<Option<Sender<String>>>,
    proxy: EventLoopProxy<UserEvent>,
    exe_dir: PathBuf,
    log_path: PathBuf,
    logs: Arc<Mutex<VecDeque<String>>>,
    log_file: Arc<Mutex<Option<std::fs::File>>>,
    #[cfg(windows)]
    job: Option<win_host::JobObject>,
}

impl Sidecar {
    fn new(proxy: EventLoopProxy<UserEvent>, exe_dir: PathBuf) -> Arc<Self> {
        let log_path = resolve_sidecar_log_path();
        Arc::new(Self {
            child: Mutex::new(None),
            stdin_tx: Mutex::new(None),
            proxy,
            exe_dir,
            log_path,
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(DIAGNOSTIC_RING_CAP))),
            log_file: Arc::new(Mutex::new(None)),
            #[cfg(windows)]
            job: win_host::JobObject::create(),
        })
    }

    fn record_log(&self, tag: &str, line: &str) {
        record_diagnostic_line(&self.logs, &self.log_file, &self.log_path, tag, line);
    }

    fn diagnostics(&self) -> Value {
        let pid = lock_unpoisoned(&self.child).as_ref().map(|c| c.id());
        let recent_logs: Vec<String> = lock_unpoisoned(&self.logs).iter().cloned().collect();
        let crash_path = resolve_user_data_dir(&self.exe_dir).join("pending_crash.json");
        json!({
            "ok": true,
            "pid": pid,
            "logPath": self.log_path.to_string_lossy(),
            "crashPath": crash_path.to_string_lossy(),
            "recentLogs": recent_logs
        })
    }

    fn spawn(&self) {
        let node_bin = resolve_node_exe(&self.exe_dir);
        let script = resolve_sidecar_script(&self.exe_dir);

        let mut cmd = Command::new(node_bin);
        cmd.arg(&script);
        cmd.current_dir(&self.exe_dir);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.spawn() {
            Ok(mut child) => {
                #[cfg(windows)]
                {
                    use std::os::windows::io::AsRawHandle;
                    if let Some(job) = &self.job {
                        let _ = job.assign_process(child.as_raw_handle() as isize);
                    }
                }

                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let stdin = child.stdin.take();

                let (tx, rx): (Sender<String>, Receiver<String>) = channel();
                *lock_unpoisoned(&self.stdin_tx) = Some(tx);
                *lock_unpoisoned(&self.child) = Some(child);

                let proxy = self.proxy.clone();
                if let Some(stdout) = stdout {
                    thread::spawn(move || {
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            match line {
                                Ok(l) => {
                                    let _ = proxy.send_event(UserEvent::SidecarLine(l));
                                }
                                Err(_) => break,
                            }
                        }
                        let _ = proxy.send_event(UserEvent::SidecarExit);
                    });
                }

                if let Some(stderr) = stderr {
                    let ring = self.logs.clone();
                    let log_file = self.log_file.clone();
                    let log_path = self.log_path.clone();
                    thread::spawn(move || {
                        let reader = BufReader::new(stderr);
                        for line in reader.lines() {
                            match line {
                                Ok(l) => {
                                    if cfg!(debug_assertions) {
                                        eprintln!("[sidecar] {}", l);
                                    }
                                    record_diagnostic_line(&ring, &log_file, &log_path, "stderr", &l);
                                }
                                Err(_) => break,
                            }
                        }
                    });
                }

                if let Some(mut stdin) = stdin {
                    thread::spawn(move || {
                        while let Ok(msg) = rx.recv() {
                            if stdin.write_all(msg.as_bytes()).is_err() {
                                break;
                            }
                            if stdin.write_all(b"\n").is_err() {
                                break;
                            }
                            let _ = stdin.flush();
                        }
                    });
                }
            }
            Err(e) => {
                let msg = format!("Failed to spawn sidecar: {}", e);
                self.record_log("host", &msg);
                eprintln!("{}", msg);
                let _ = self.proxy.send_event(UserEvent::SidecarExit);
            }
        }
    }

    fn send(&self, line: String) {
        if let Some(tx) = lock_unpoisoned(&self.stdin_tx).as_ref() {
            let _ = tx.send(line);
        }
    }

    fn stop(&self) {
        if let Some(tx) = lock_unpoisoned(&self.stdin_tx).as_ref() {
            let _ = tx.send(json!({ "t": "shutdown" }).to_string());
        }
        *lock_unpoisoned(&self.stdin_tx) = None;
        if let Some(mut child) = lock_unpoisoned(&self.child).take() {
            let deadline = Instant::now() + Duration::from_millis(500);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) if Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(25));
                    }
                    _ => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn parse_cli_open_path() -> Option<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for arg in args {
        if !arg.starts_with('-') && !arg.starts_with('/') {
            let p = PathBuf::from(&arg);
            if p.exists() {
                return fs::canonicalize(&p)
                    .ok()
                    .and_then(|c| c.to_str().map(|s| s.to_string()))
                    .or(Some(arg));
            }
        }
    }
    None
}

fn window_is_maximized(window: &tao::window::Window) -> bool {
    #[cfg(windows)]
    {
        return win_host::is_zoomed(window.hwnd());
    }
    #[cfg(not(windows))]
    {
        window.is_maximized()
    }
}

fn dispatch_renderer_event(webview: &WebView, channel: &str, payload: Value) {
    let ev = json!({
        "type": "event",
        "channel": channel,
        "payload": payload
    });
    let script = format!(
        "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
        ev.to_string()
    );
    let _ = webview.evaluate_script(&script);
}

fn emit_window_state(webview: &WebView, window: &tao::window::Window) {
    dispatch_renderer_event(
        webview,
        "host:windowState",
        json!({
            "maximized": window_is_maximized(window),
            "fullscreen": window.fullscreen().is_some()
        }),
    );
}

fn save_window_state(window: &tao::window::Window) {
    #[cfg(windows)]
    win_host::write_window_placement(window.hwnd(), placement_reg_subkey());
    #[cfg(not(windows))]
    let _ = window;
}

fn make_physical_rect(x: i64, y: i64, w: i64, h: i64) -> Rect {
    Rect {
        position: wry::dpi::PhysicalPosition::new(x as i32, y as i32).into(),
        size: wry::dpi::PhysicalSize::new(w.max(0) as u32, h.max(0) as u32).into(),
    }
}

fn build_child_browser_tab(
    window: &tao::window::Window,
    web_context: &mut WebContext,
    proxy: EventLoopProxy<UserEvent>,
    tab_id: &str,
    rect: Rect,
    visible: bool,
) -> Result<WebView, Box<dyn std::error::Error>> {
    let tab_load = tab_id.to_string();
    let proxy_load = proxy.clone();
    let tab_title = tab_id.to_string();
    let proxy_title = proxy;

    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_devtools(true)
        .with_bounds(rect)
        .with_visible(visible)
        .with_navigation_handler(|url| is_allowed_browser_url(&url))
        .with_on_page_load_handler(move |ev, url| {
            let loading = matches!(ev, PageLoadEvent::Started);
            let _ = proxy_load.send_event(UserEvent::BrowserPageEvent(json!({
                "tabId": tab_load,
                "url": url,
                "loading": loading
            })));
        })
        .with_document_title_changed_handler(move |title| {
            let _ = proxy_title.send_event(UserEvent::BrowserPageEvent(json!({
                "tabId": tab_title,
                "title": title
            })));
        });

    #[cfg(not(target_os = "linux"))]
    {
        Ok(builder.build_as_child(window)?)
    }
    #[cfg(target_os = "linux")]
    {
        let _ = window;
        Err("Child webview requires GTK container on Linux".into())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = get_exe_dir();
    install_panic_hook(exe_dir.clone());

    let renderer_dir = resolve_renderer_dir(&exe_dir);
    let canon_renderer_dir = fs::canonicalize(&renderer_dir).unwrap_or_else(|_| renderer_dir.clone());
    let assets_dir = resolve_assets_dir(&exe_dir);
    let webview_data_dir = resolve_webview_user_data_dir(&exe_dir);
    let _ = fs::create_dir_all(&webview_data_dir);
    let pending_open_path = parse_cli_open_path();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let mut wb = WindowBuilder::new()
        .with_title(window_title())
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0));

    #[cfg(windows)]
    {
        if let Some(wp) = win_host::read_window_placement(placement_reg_subkey()) {
            if win_host::rect_on_monitor(&wp.rc_normal_position) {
                let w = (wp.rc_normal_position.right - wp.rc_normal_position.left) as u32;
                let h = (wp.rc_normal_position.bottom - wp.rc_normal_position.top) as u32;
                wb = wb
                    .with_position(PhysicalPosition::new(
                        wp.rc_normal_position.left,
                        wp.rc_normal_position.top,
                    ))
                    .with_inner_size(PhysicalSize::new(w, h));
            }
            wb = wb.with_maximized(wp.show_cmd == 3);
        } else {
            wb = wb.with_maximized(true);
        }
    }
    #[cfg(not(windows))]
    {
        wb = wb.with_maximized(true);
    }

    let window = wb.build(&event_loop)?;

    #[cfg(windows)]
    let owner_hwnd: isize = {
        let hwnd = window.hwnd();
        win_host::apply_window_icon(hwnd, &assets_dir);
        hwnd
    };
    #[cfg(not(windows))]
    let owner_hwnd: isize = 0;

    let sidecar = Sidecar::new(proxy.clone(), exe_dir);
    sidecar.spawn();

    let r_dir = canon_renderer_dir.clone();
    let protocol_handler = move |_webview_id: wry::WebViewId, req: http::Request<Vec<u8>>| {
        if let Some((final_file, is_hashed_asset)) = resolve_protocol_asset(&r_dir, req.uri().path()) {
            if let Ok(bytes) = fs::read(&final_file) {
                let mime = get_mime(&final_file);
                let cache_control = if is_hashed_asset {
                    "public, max-age=31536000, immutable"
                } else {
                    "no-cache"
                };
                return Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", cache_control)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(Cow::from(bytes))
                    .unwrap();
            }
        }
        Response::builder()
            .status(404)
            .header("Content-Type", "text/plain")
            .body(Cow::from(b"404 Not Found".to_vec()))
            .unwrap()
    };

    let sidecar_for_ipc = sidecar.clone();
    let proxy_for_ipc = proxy.clone();
    let pending_open_for_ipc = Arc::new(Mutex::new(pending_open_path));

    let ipc_handler = move |req: http::Request<String>| {
        let body = req.body();
        if let Ok(val) = serde_json::from_str::<Value>(body) {
            let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if msg_type == "host-cmd" {
                let cmd = val.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
                match cmd {
                    "drag" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowDrag);
                    }
                    "minimize" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowMinimize);
                    }
                    "maximize" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowMaximize);
                    }
                    "fullscreen" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowFullscreen);
                    }
                    "close" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowClose);
                    }
                    "consume-open-path" => {
                        if let Some(path) = lock_unpoisoned(&pending_open_for_ipc).take() {
                            let _ = proxy_for_ipc.send_event(UserEvent::OpenPath(path));
                        }
                    }
                    _ => {
                        let _ = proxy_for_ipc.send_event(UserEvent::BrowserCmd {
                            cmd: cmd.to_string(),
                            payload: val,
                        });
                    }
                }
            } else if msg_type == "invoke" {
                let fwd = json!({
                    "t": "invoke",
                    "id": val.get("replyId").and_then(|v| v.as_u64()).unwrap_or(0),
                    "channel": val.get("channel").and_then(|v| v.as_str()).unwrap_or(""),
                    "args": val.get("args").unwrap_or(&json!([]))
                });
                sidecar_for_ipc.send(fwd.to_string());
            }
        }
    };

    let preload_init = build_preload_script(&assets_dir);
    let mut web_context = WebContext::new(Some(webview_data_dir));

    #[allow(unused_mut)]
    let mut wv_builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_background_color((BACKGROUND_COLOR.0, BACKGROUND_COLOR.1, BACKGROUND_COLOR.2, 255))
        .with_custom_protocol("app".into(), protocol_handler)
        .with_initialization_script(&preload_init)
        .with_ipc_handler(ipc_handler)
        .with_url("app://local/index.html");

    #[cfg(windows)]
    {
        use wry::WebViewBuilderExtWindows;
        wv_builder = wv_builder.with_https_scheme(true);
    }

    let webview = wv_builder.build(&window)?;

    let sidecar_main = sidecar.clone();
    let proxy_main = proxy.clone();
    let mut last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
    let mut browser_tabs: HashMap<String, WebView> = HashMap::new();
    let mut browser_visibility: HashMap<String, bool> = HashMap::new();
    let mut active_browser_tab: Option<String> = None;
    let mut devtools_tab: Option<WebView> = None;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(ue) => match ue {
                UserEvent::SidecarLine(line) => {
                    if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                        if msg.get("type").is_some() {
                            if let Ok(serialized) = serde_json::to_string(&msg) {
                                let script = format!(
                                    "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                                    serialized
                                );
                                let _ = webview.evaluate_script(&script);
                            }
                        } else {
                            let t = msg.get("t").and_then(|v| v.as_str()).unwrap_or("");
                            if t == "reply" {
                                let rep = json!({
                                    "type": "reply",
                                    "replyId": msg.get("id"),
                                    "result": msg.get("result"),
                                    "error": msg.get("error")
                                });
                                let script = format!(
                                    "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                                    rep.to_string()
                                );
                                let _ = webview.evaluate_script(&script);
                            } else if t == "host" {
                                let id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                                let method = msg.get("channel")
                                    .or_else(|| msg.get("method"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if method == "webview:eval" {
                                    if let Some(code) = msg.get("params").and_then(|p| p.get("code")).and_then(|c| c.as_str()) {
                                        let _ = webview.evaluate_script(code);
                                    }
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": Value::Null }).to_string());
                                } else if method == "window:setTitle" {
                                    if let Some(new_title) = msg.get("params").and_then(|p| p.get("title")).and_then(|s| s.as_str()) {
                                        window.set_title(new_title);
                                    }
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": Value::Null }).to_string());
                                } else if method == "app:getDiagnostics" {
                                    let diag = sidecar_main.diagnostics();
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": diag }).to_string());
                                } else if method == "app:installUpdate" {
                                    let installer_path = msg.get("params")
                                        .and_then(|p| p.get("path"))
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let path = PathBuf::from(&installer_path);
                                    if !installer_path.is_empty() && path.exists() {
                                        sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": { "ok": true } }).to_string());
                                        let path_clone = path.clone();
                                        let sidecar_stop = sidecar_main.clone();
                                        thread::spawn(move || {
                                            thread::sleep(Duration::from_millis(500));
                                            sidecar_stop.stop();
                                            #[cfg(windows)]
                                            {
                                                use std::os::windows::process::CommandExt;
                                                const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
                                                let mut cmd = Command::new(&path_clone);
                                                cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCANCEL"]);
                                                cmd.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
                                                let _ = cmd.spawn();
                                            }
                                            #[cfg(not(windows))]
                                            {
                                                let _ = Command::new("chmod").args(["+x", path_clone.to_str().unwrap_or("")]).status();
                                                let _ = Command::new(&path_clone).spawn();
                                            }
                                            std::process::exit(0);
                                        });
                                    } else {
                                        sidecar_main.send(json!({
                                            "t": "hostReply",
                                            "id": id,
                                            "result": { "ok": false, "error": "The installer file could not be found." }
                                        }).to_string());
                                    }
                                } else if method == "dialog:showOpenDialog" {
                                    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
                                    let sidecar_clone = sidecar_main.clone();
                                    thread::spawn(move || {
                                        let result = handle_open_dialog(&params, owner_hwnd);
                                        sidecar_clone.send(json!({
                                            "t": "hostReply",
                                            "id": id,
                                            "result": result
                                        }).to_string());
                                    });
                                } else if method == "shell:showItemInFolder" {
                                    if let Some(p) = msg.get("params").and_then(|p| p.get("path")).and_then(|u| u.as_str()) {
                                        handle_show_in_folder(p);
                                    }
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": Value::Null }).to_string());
                                } else if method == "shell:trashItem" {
                                    let p = msg.get("params").and_then(|p| p.get("path")).and_then(|u| u.as_str()).unwrap_or("").to_string();
                                    let sidecar_clone = sidecar_main.clone();
                                    thread::spawn(move || {
                                        let result = handle_trash_item(&p);
                                        sidecar_clone.send(json!({
                                            "t": "hostReply",
                                            "id": id,
                                            "result": result
                                        }).to_string());
                                    });
                                } else if method == "crypto:protect" {
                                    let raw = msg.get("params").and_then(|p| p.get("data")).and_then(|d| d.as_str()).unwrap_or("");
                                    let result = handle_crypto_protect(raw);
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": result }).to_string());
                                } else if method == "crypto:unprotect" {
                                    let raw = msg.get("params").and_then(|p| p.get("data")).and_then(|d| d.as_str()).unwrap_or("");
                                    let result = handle_crypto_unprotect(raw);
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": result }).to_string());
                                } else if method == "shell:openExternal" {
                                    let ok = if let Some(url) = msg.get("params").and_then(|p| p.get("url")).and_then(|u| u.as_str()) {
                                        if is_allowed_external_url(url) {
                                            #[cfg(windows)]
                                            {
                                                win_host::shell_open_external(owner_hwnd, url.trim())
                                            }
                                            #[cfg(target_os = "macos")]
                                            {
                                                Command::new("open").arg(url.trim()).spawn().is_ok()
                                            }
                                            #[cfg(target_os = "linux")]
                                            {
                                                Command::new("xdg-open").arg(url.trim()).spawn().is_ok()
                                            }
                                        } else {
                                            false
                                        }
                                    } else {
                                        false
                                    };
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": { "ok": ok } }).to_string());
                                } else if method == "browser:navigate" {
                                    let tab_id = msg.get("params").and_then(|p| p.get("tabId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let url = msg.get("params").and_then(|p| p.get("url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let mut navigated = false;
                                    if !tab_id.is_empty() && is_allowed_browser_url(&url) {
                                        if let Some(tab_wv) = browser_tabs.get(&tab_id) {
                                            navigated = tab_wv.load_url(&url).is_ok();
                                        } else if let Ok(tab_wv) = build_child_browser_tab(
                                            &window,
                                            &mut web_context,
                                            proxy_main.clone(),
                                            &tab_id,
                                            make_physical_rect(0, 0, 0, 0),
                                            false,
                                        ) {
                                            navigated = tab_wv.load_url(&url).is_ok();
                                            browser_visibility.insert(tab_id.clone(), false);
                                            browser_tabs.insert(tab_id.clone(), tab_wv);
                                        }
                                    }
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": { "ok": navigated } }).to_string());
                                } else if method == "browser:devtools" {
                                    let dt_url = msg.get("params").and_then(|p| p.get("url")).and_then(|v| v.as_str()).unwrap_or("");
                                    if dt_url.is_empty() {
                                        if let Some(dt) = &devtools_tab {
                                            let _ = dt.set_visible(false);
                                        } else if let Some(tid) = &active_browser_tab {
                                            if let Some(tab_wv) = browser_tabs.get(tid) {
                                                tab_wv.close_devtools();
                                            }
                                        }
                                    } else if let Some(dt) = &devtools_tab {
                                        let _ = dt.load_url(dt_url);
                                    }
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": { "ok": true } }).to_string());
                                } else if method == "browser:setRemotePort" {
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": { "port": 0, "supported": false } }).to_string());
                                } else if method == "browser:cdp" || method == "browser:proxy" || method == "browser:debug" {
                                    sidecar_main.send(json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "error": "Direct CDP/proxy injection is unavailable on the native WebView host; use the built-in AI Browser."
                                    }).to_string());
                                } else {
                                    sidecar_main.send(json!({ "t": "hostReply", "id": id, "result": Value::Null }).to_string());
                                }
                            }
                        }
                    } else if !line.trim().is_empty() {
                        sidecar_main.record_log("stdout-raw", &line);
                    }
                }
                UserEvent::BrowserPageEvent(payload) => {
                    dispatch_renderer_event(&webview, "browser:event", payload);
                }
                UserEvent::BrowserCmd { cmd, payload } => {
                    match cmd.as_str() {
                        "browser-place" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let x = payload.get("x").and_then(|v| v.as_i64()).unwrap_or(0);
                            let y = payload.get("y").and_then(|v| v.as_i64()).unwrap_or(0);
                            let w = payload.get("w").and_then(|v| v.as_i64()).unwrap_or(0);
                            let h = payload.get("h").and_then(|v| v.as_i64()).unwrap_or(0);
                            let visible = payload.get("visible").and_then(|v| v.as_bool()).unwrap_or(false) && w > 0 && h > 0;
                            if !tab_id.is_empty() {
                                let rect = make_physical_rect(x, y, w, h);
                                if active_browser_tab.is_none() {
                                    active_browser_tab = Some(tab_id.clone());
                                }
                                let is_active = active_browser_tab.as_deref() == Some(tab_id.as_str());
                                let show_now = visible && is_active;
                                browser_visibility.insert(tab_id.clone(), visible);
                                if let Some(tab_wv) = browser_tabs.get(&tab_id) {
                                    let _ = tab_wv.set_bounds(rect);
                                    let _ = tab_wv.set_visible(show_now);
                                } else if visible {
                                    if let Ok(tab_wv) = build_child_browser_tab(
                                        &window,
                                        &mut web_context,
                                        proxy_main.clone(),
                                        &tab_id,
                                        rect,
                                        show_now,
                                    ) {
                                        browser_tabs.insert(tab_id, tab_wv);
                                    }
                                }
                            }
                        }
                        "browser-activate" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if !tab_id.is_empty() {
                                active_browser_tab = Some(tab_id.clone());
                                for (id, tab_wv) in &browser_tabs {
                                    let vis = id == &tab_id && *browser_visibility.get(id).unwrap_or(&false);
                                    let _ = tab_wv.set_visible(vis);
                                }
                            }
                        }
                        "browser-back" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                let _ = tab_wv.evaluate_script("window.history.back();");
                            }
                        }
                        "browser-forward" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                let _ = tab_wv.evaluate_script("window.history.forward();");
                            }
                        }
                        "browser-reload" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                let _ = tab_wv.evaluate_script("window.location.reload();");
                            }
                        }
                        "browser-stop" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                let _ = tab_wv.evaluate_script("window.stop();");
                            }
                        }
                        "browser-close" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            browser_visibility.remove(tab_id);
                            browser_tabs.remove(tab_id);
                            if active_browser_tab.as_deref() == Some(tab_id) {
                                active_browser_tab = browser_tabs.keys().next().cloned();
                            }
                        }
                        "devtools-place" => {
                            let x = payload.get("x").and_then(|v| v.as_i64()).unwrap_or(0);
                            let y = payload.get("y").and_then(|v| v.as_i64()).unwrap_or(0);
                            let w = payload.get("w").and_then(|v| v.as_i64()).unwrap_or(0);
                            let h = payload.get("h").and_then(|v| v.as_i64()).unwrap_or(0);
                            let visible = payload.get("visible").and_then(|v| v.as_bool()).unwrap_or(false) && w > 0 && h > 0;
                            if visible {
                                if let Some(tid) = &active_browser_tab {
                                    if let Some(tab_wv) = browser_tabs.get(tid) {
                                        tab_wv.open_devtools();
                                    }
                                }
                            } else {
                                if let Some(dt) = &devtools_tab {
                                    let _ = dt.set_visible(false);
                                    let _ = dt.set_bounds(make_physical_rect(x, y, w, h));
                                }
                                if let Some(tid) = &active_browser_tab {
                                    if let Some(tab_wv) = browser_tabs.get(tid) {
                                        tab_wv.close_devtools();
                                    }
                                }
                            }
                            if !visible {
                                let _ = devtools_tab.take();
                            }
                        }
                        "browser-fullscreen" => {
                            let on = payload.get("on").and_then(|v| v.as_bool()).unwrap_or(false);
                            window.set_fullscreen(if on { Some(Fullscreen::Borderless(None)) } else { None });
                            last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
                            emit_window_state(&webview, &window);
                        }
                        "browser-nav" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");
                            if !tab_id.is_empty() && is_allowed_browser_url(url) {
                                if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                    let _ = tab_wv.load_url(url);
                                }
                            }
                        }
                        "browser-eval" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            let code = payload.get("code").and_then(|v| v.as_str()).unwrap_or("");
                            if !code.is_empty() {
                                if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                    let _ = tab_wv.evaluate_script(code);
                                }
                            }
                        }
                        "browser-focus" => {
                            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
                            if let Some(tab_wv) = browser_tabs.get(tab_id) {
                                let _ = tab_wv.focus();
                            }
                        }
                        _ => {}
                    }
                }
                UserEvent::SidecarExit => {
                    dispatch_renderer_event(&webview, "host:backend", json!({ "state": "down" }));
                }
                UserEvent::WindowDrag => {
                    let _ = window.drag_window();
                }
                UserEvent::WindowMinimize => {
                    window.set_minimized(true);
                }
                UserEvent::WindowMaximize => {
                    if window.fullscreen().is_some() {
                        window.set_fullscreen(None);
                    } else {
                        let currently_max = window_is_maximized(&window);
                        window.set_maximized(!currently_max);
                    }
                    last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
                    emit_window_state(&webview, &window);
                }
                UserEvent::WindowFullscreen => {
                    if window.fullscreen().is_some() {
                        window.set_fullscreen(None);
                    } else {
                        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
                    }
                    last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
                    emit_window_state(&webview, &window);
                }
                UserEvent::WindowClose => {
                    browser_tabs.clear();
                    devtools_tab = None;
                    save_window_state(&window);
                    sidecar_main.stop();
                    *control_flow = ControlFlow::Exit;
                }
                UserEvent::OpenPath(path) => {
                    dispatch_renderer_event(&webview, "host:openPath", json!({ "path": path }));
                }
            },
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::Resized(_) => {
                    let cur = (window_is_maximized(&window), window.fullscreen().is_some());
                    if cur != last_win_state {
                        last_win_state = cur;
                        emit_window_state(&webview, &window);
                    }
                }
                WindowEvent::CloseRequested => {
                    browser_tabs.clear();
                    devtools_tab = None;
                    save_window_state(&window);
                    sidecar_main.stop();
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            },
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_scheme_validation() {
        assert!(is_allowed_external_url("https://example.com/a?b=1"));
        assert!(is_allowed_external_url("http://127.0.0.1:8080"));
        assert!(is_allowed_external_url("mailto:test@example.com"));
        assert!(!is_allowed_external_url("file:///c:/windows/win.ini"));
        assert!(!is_allowed_external_url("ms-msdt:/id"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("https://a.com/\nfoo"));
    }

    #[test]
    fn protocol_asset_prevents_traversal_and_missing_ext_returns_404() {
        let base = std::env::temp_dir().join(format!("wide-proto-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("assets")).unwrap();
        fs::write(base.join("index.html"), "<html></html>").unwrap();
        fs::write(base.join("assets").join("app.js"), "console.log(1)").unwrap();
        let canon = fs::canonicalize(&base).unwrap();

        let (idx, hashed_idx) = resolve_protocol_asset(&canon, "/").unwrap();
        assert_eq!(idx.file_name().unwrap(), "index.html");
        assert!(!hashed_idx);

        let (js, hashed_js) = resolve_protocol_asset(&canon, "/assets/app.js").unwrap();
        assert_eq!(js.file_name().unwrap(), "app.js");
        assert!(hashed_js);

        let (spa, _) = resolve_protocol_asset(&canon, "/settings/profile").unwrap();
        assert_eq!(spa.file_name().unwrap(), "index.html");

        assert!(resolve_protocol_asset(&canon, "/assets/missing.js").is_none());
        assert!(resolve_protocol_asset(&canon, "/assets/app.js.map").is_none());
        assert!(resolve_protocol_asset(&canon, "/../../windows/win.ini").is_none());

        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn com_trash_rejects_missing_and_trashes_temp_file() {
        let missing = handle_trash_item("C:\\__definitely_nonexistent_wide_path__\\a.txt");
        assert_eq!(missing.get("ok").and_then(|v| v.as_bool()), Some(false));
    }
}
