fn main() {
    #[cfg(windows)]
    {
        let pkg_name = std::env::var("CARGO_PKG_NAME").unwrap_or_else(|_| "wide".to_string());
        let is_app = pkg_name == "wide-app";
        let display_name = if is_app { "Wide App" } else { "Wide IDE" };
        let exe_name = format!("{}.exe", pkg_name);

        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/wide.ico");
        res.set("ProductName", display_name);
        res.set("FileDescription", display_name);
        res.set("InternalName", &pkg_name);
        res.set("OriginalFilename", &exe_name);
        let _ = res.compile();
    }
}
