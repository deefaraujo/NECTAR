$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$a = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NectarInput {
 private static IntPtr browserTarget=IntPtr.Zero;
 private static void CheckFocus() {
  if(browserTarget!=IntPtr.Zero && GetForegroundWindow()!=browserTarget)throw new Exception("NECTAR_BROWSER_FOCUS: o navegador perdeu o foco; a digitacao foi interrompida antes de enviar mais teclas.");
 }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 public static bool BrowserWindow(IntPtr h) {
  uint pid;GetWindowThreadProcessId(h,out pid);
  string name=System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
  return name=="chrome"||name=="msedge"||name=="firefox"||name=="brave"||name=="vivaldi"||name=="opera";
 }
 public static void AssertBrowser(string kind,int x,int y) {
  IntPtr foreground=GetForegroundWindow();
  if(foreground==IntPtr.Zero||!BrowserWindow(foreground))throw new Exception("NECTAR_BROWSER_FOCUS: coloque o navegador do teste em primeiro plano; nenhuma entrada foi enviada.");
  browserTarget=foreground;
  if(kind=="clicar"||kind=="rolar"){POINT p=new POINT();if(kind=="rolar")GetCursorPos(out p);else{p.x=x;p.y=y;}IntPtr target=WindowFromPoint(p);
   if(target==IntPtr.Zero||GetAncestor(target,3)!=GetAncestor(foreground,3))throw new Exception("NECTAR_BROWSER_TARGET: clique fora da janela do navegador bloqueado; nenhuma entrada foi enviada.");
  }
 }
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,int data,UIntPtr extra);
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,INPUT[] inputs,int size);
 public static void Key(ushort vk,ushort scan,uint flags) {
  CheckFocus();
  INPUT[] a=new INPUT[2]; a[0].type=1; a[0].u.ki.vk=vk; a[0].u.ki.scan=scan; a[0].u.ki.flags=flags;
  a[1]=a[0]; a[1].u.ki.flags=flags|2;
  if(SendInput(2,a,Marshal.SizeOf(typeof(INPUT)))!=2) throw new Exception("Windows recusou a entrada");
 }
 public static void Chord(ushort modifier,ushort vk) {
  CheckFocus();
  INPUT[] a=new INPUT[4];for(int i=0;i<4;i++)a[i].type=1;
  a[0].u.ki.vk=modifier;a[1].u.ki.vk=vk;
  a[2].u.ki.vk=vk;a[2].u.ki.flags=2;a[3].u.ki.vk=modifier;a[3].u.ki.flags=2;
  if(SendInput(4,a,Marshal.SizeOf(typeof(INPUT)))!=4) throw new Exception("Windows recusou o atalho");
 }
}
'@
if($a.tipo -in @('clicar','digitar','codigo','tecla','rolar')) { [NectarInput]::AssertBrowser($a.tipo,$a.px,$a.py) }
$keys=@{TAB=9;ENTER=13;BACKSPACE=8;SPACE=32;UP=38;DOWN=40;LEFT=37;RIGHT=39;ESC=27;HOME=36;END=35;DELETE=46;A=65;Z=90}
$cps=12
if($null -ne $a.caracteresPorSegundo){$cps=[int]$a.caracteresPorSegundo}
if($cps -lt 5 -or $cps -gt 25){throw 'Velocidade de digitacao invalida'}
$intervalo=1000.0/$cps
function Esperar-Digitacao([char]$caractere) {
  $minimo=[Math]::Max(15,[int]($intervalo*0.75))
  $maximo=[int]($intervalo*1.25)+1
  $pausa=Get-Random -Minimum $minimo -Maximum $maximo
  if($caractere -eq "`n"){$pausa+=Get-Random -Minimum 90 -Maximum 181}
  Start-Sleep -Milliseconds $pausa
}
switch ($a.tipo) {
 'clicar' { [void][NectarInput]::SetCursorPos($a.px,$a.py); [NectarInput]::mouse_event(6,0,0,0,[UIntPtr]::Zero) }
 'digitar' { foreach($c in $a.texto.ToCharArray()) { [NectarInput]::Key(0,[System.UInt16]$c,4); Esperar-Digitacao $c } }
 'codigo' {
   $texto = $a.texto.Replace("`r`n","`n").Replace("`r","`n").Replace("`t",'    ')
   foreach($c in $texto.ToCharArray()) {
     if($c -eq "`n") {
       [NectarInput]::Key(13,0,0)
       Start-Sleep -Milliseconds 30
       # Select the auto-indentation; the next character replaces it.
       # Don't use Backspace: with no indentation it would delete the line break.
       [NectarInput]::Chord(16,36)
     } else { [NectarInput]::Key(0,[System.UInt16]$c,4) }
     Esperar-Digitacao $c
   }
 }
 'tecla' {
   $partes=$a.tecla.Split('+')
   if($partes.Length -eq 2){$mod=if($partes[0] -eq 'CTRL'){17}else{16};[NectarInput]::Chord($mod,$keys[$partes[1]])}
   else{[NectarInput]::Key($keys[$a.tecla],0,0)}
 }
 'rolar' { [NectarInput]::mouse_event(2048,0,0,(-120 * $a.passos),[UIntPtr]::Zero) }
}
