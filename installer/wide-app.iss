#define AppName "Wide App"
#define AppVersion "0.3101126"
#define AppPublisher "sl4de"
#define AppRepo "https://github.com/sl4de0day/wide-app"

[Setup]
AppId={{E5D8F2A1-3C4B-4E6F-A8D9-1B2C3D4E5F6A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppRepo}
AppSupportURL={#AppRepo}/issues
AppUpdatesURL={#AppRepo}/releases
DefaultDirName={localappdata}\Programs\Wide App
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=Wide-App-Setup-{#AppVersion}
SetupIconFile=..\native-host\assets\wide.ico
UninstallDisplayIcon={app}\wide-app.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
ShowLanguageDialog=yes
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=yes
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.DesktopIcon=Create a desktop shortcut
english.ShortcutsGroup=Additional shortcuts:
english.LaunchApp=Launch Wide App

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:ShortcutsGroup}"

[Files]
Source: "..\dist\wide-app-win-x64\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\wide-app.exe"; IconFilename: "{app}\assets\wide.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\wide-app.exe"; IconFilename: "{app}\assets\wide.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\wide-app.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\wide-app.exe"; Flags: nowait runasoriginaluser skipifnotsilent
