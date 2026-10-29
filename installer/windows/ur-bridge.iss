// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Windows Installer (Inno Setup)
// ─────────────────────────────────────────────────────────────────────────────
//
// Incorporates fixes confirmed by real external installation testing on a
// genuine Windows machine:
//   - Removed "createallsubdirs" from single-file entries (an invalid flag
//     combination that caused a real Inno Setup compile error).
//   - Uses "//" line comments throughout (this file), not "{}" - an actual
//     Inno Setup comment syntax mismatch that caused a real compile error
//     in an earlier draft of this script.
//
// IMPORTANT: this installer packages the REAL, COMPILED dist/ output (run
// `npm run build` BEFORE building this installer) - NOT the raw TypeScript
// source and NOT node_modules. This is the actual fix for the externally-
// reported "tsx not found" Critical bug: dist/ is fully self-contained
// (plain JavaScript, no tsx needed at runtime) - the installed CLI/IDE
// only need Node.js itself, a disclosed, documented platform prerequisite,
// not something this installer bundles.

#define MyAppName "UR-Bridge"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "UR-Bridge Contributors"

[Setup]
AppId={{8F2C9A1E-4B3D-4E7A-9C1F-2D8E5A6B7C90}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer-output
OutputBaseFilename=ur-bridge-setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
// The real, compiled build output - self-contained, no tsx needed at
// runtime. Run `npm run build` before compiling this installer.
// "createallsubdirs" is only used here, on wildcard directory entries -
// removing it from single-file entries below is the actual reported fix.
Source: "..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\bin\*"; DestDir: "{app}\bin"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "open-ide.bat"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "..\examples\*"; DestDir: "{app}\examples"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\stdlib\*"; DestDir: "{app}\stdlib"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\docs\INSTALLATION_GUIDE.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[Icons]
// FIXED — real, externally-reported bug: the desktop shortcut and
// open-ide.bat previously didn't work because they pointed at files
// that were never actually copied by this installer in the first
// place (bin/ur-ide.mjs alone, which itself depended on tsx never
// being present post-install — see bin/ur-ide.mjs's own fix comment).
// Now points at open-ide.bat, which launches the real, compiled
// dist/src/ide/server.js directly with plain node, and — critically —
// never closes silently on failure (shows a clear error and pauses).
Name: "{group}\UR IDE"; Filename: "{app}\bin\open-ide.bat"
Name: "{commondesktop}\UR IDE"; Filename: "{app}\bin\open-ide.bat"; Tasks: desktopicon
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Tasks]
Name: "addtopath"; Description: "Add UR-Bridge to PATH (recommended)"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a desktop icon for UR IDE"; Flags: checkedonce

[Code]
procedure CreateCmdWrapper(FileName, RelativeJsPath: String);
var
  Content: String;
begin
  // %~dp0 expands to the directory containing this .cmd file at runtime,
  // making the wrapper location-independent.
  Content := '@echo off' + #13#10 +
             'node "%~dp0..\' + RelativeJsPath + '" %*' + #13#10;
  SaveStringToFile(FileName, Content, False);
end;

function NeedsAddPath(Param: String): boolean;
var
  OrigPath: String;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

// A13 fix: a previous UR-Bridge installation (a different version's
// directory, or a leftover entry after an incomplete uninstall) can leave
// a stale "...\UR-Bridge\bin" segment on PATH. NeedsAddPath above only
// checks whether *this* install's own {app}\bin is already present - it
// never removes an old, different UR-Bridge path. If that stale segment
// sits earlier on PATH than the new, correct one, Windows resolves "ur"
// to the wrong (missing or outdated) location - the reported A13 symptom.
// This strips out any PATH segment containing "UR-Bridge" (case-
// insensitive) that is not an exact match for the current {app}\bin,
// before the [Registry] section below adds the correct one.
function SplitPathSegments(S: String): TArrayOfString;
var
  Segments: TArrayOfString;
  StartPos, SepPos, RemainingLen: Integer;
begin
  SetArrayLength(Segments, 0);
  StartPos := 1;
  while StartPos <= Length(S) + 1 do
  begin
    RemainingLen := Length(S) - StartPos + 1;
    SepPos := Pos(';', Copy(S, StartPos, RemainingLen));
    SetArrayLength(Segments, GetArrayLength(Segments) + 1);
    if SepPos = 0 then
    begin
      Segments[GetArrayLength(Segments) - 1] := Copy(S, StartPos, RemainingLen);
      StartPos := Length(S) + 2;
    end
    else
    begin
      Segments[GetArrayLength(Segments) - 1] := Copy(S, StartPos, SepPos - 1);
      StartPos := StartPos + SepPos;
    end;
  end;
  Result := Segments;
end;

procedure RemoveStalePathEntries();
var
  OrigPath, CurrentAppBin, NewPath, Segment: String;
  Segments: TArrayOfString;
  I: Integer;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
    exit;
  CurrentAppBin := ExpandConstant('{app}\bin');
  Segments := SplitPathSegments(OrigPath);
  NewPath := '';
  for I := 0 to GetArrayLength(Segments) - 1 do
  begin
    Segment := Segments[I];
    if Segment = '' then
      continue;
    if (Pos('ur-bridge', Lowercase(Segment)) > 0) and (CompareText(Segment, CurrentAppBin) <> 0) then
      continue;
    if NewPath = '' then
      NewPath := Segment
    else
      NewPath := NewPath + ';' + Segment;
  end;
  if NewPath <> OrigPath then
    RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', NewPath);
end;

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
  ValueData: "{olddata};{app}\bin"; Tasks: addtopath; Check: NeedsAddPath('{app}\bin')

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    RemoveStalePathEntries();
    CreateCmdWrapper(ExpandConstant('{app}\bin\ur.cmd'), 'dist\src\cli\index.js');
    CreateCmdWrapper(ExpandConstant('{app}\bin\ur-ide.cmd'), 'dist\src\ide\server.js');
  end;
end;
