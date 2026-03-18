; Sentinel Installer — Inno Setup Script
; Requires Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
; Build: Run build.ps1 first to generate publish/ folder, then compile this .iss file.

#define AppName "Sentinel"
#define AppVersion "1.0.0"
#define AppPublisher "Sentinel"
#define AppURL "https://github.com/sentinel"
#define AppExeName "Sentinel.exe"

[Setup]
AppId={{B7F3A2E1-4D5C-4A8B-9E3F-1C2D5A6B7E8F}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=installer
OutputBaseFilename=SentinelSetup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=Sentinel.Engine\sentinel.ico
UninstallDisplayIcon={app}\{#AppExeName}
PrivilegesRequired=lowest
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupentry"; Description: "Start Sentinel with Windows"; GroupDescription: "System Integration:"

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Sentinel"; ValueData: """{app}\{#AppExeName}"""; Flags: uninsdeletevalue; Tasks: startupentry

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
