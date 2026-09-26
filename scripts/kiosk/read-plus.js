// Read every PLU (RT89) record off one Hobart HT scale into a .ht file.
// Nashorn script for HCT's bundled JRE. Run from the agent folder through java.exe
// (jjs -cp rejects multi-entry classpaths):
//   hct\jre\bin\java.exe -cp "hct\HCT.exe;hct\lib\*" jdk.nashorn.tools.Shell read-plus.js -- <ip> [out.ht]
//
// HCT's CLI (com.hobart.hct.cli.CLIProcessor) only accepts READ_ALL_LABELS,
// READ_ALL_GRAPHICS, READ_ALL_CONFIG and SEND_HOBART_FILE, so there is no
// "-a READ_ALL_ITEMS". This makes the same call the CLI makes for those reads
// (new HTSeries_CommDriver, setIP_address, readDataFromScaleToFile) with
// Scale_Comm_Driver.READ_ALL_ITEMS = 0, which HCT sends as request RT53.
// Read-only: it sends one request, writes each record it receives (one per
// line, Cp1252) and stops at RTFF. No delete or send code is involved.

var IP   = arguments[0] || '192.168.1.190'
var OUT  = arguments[1] || ('PLU_read_' + IP.split('.').pop() + '.ht')
var READ_ALL_ITEMS = 0

var Driver = Java.type('com.hobart.hct.comm.HTSeries_CommDriver')
var File   = Java.type('java.io.File')

var drv = new Driver()
drv.setIP_address(IP)
var t0 = Date.now()
try {
  var n = drv.readDataFromScaleToFile(READ_ALL_ITEMS, new File(OUT))
  print(n + ' records received from ' + IP + ' in ' + (Date.now() - t0) + ' ms -> ' + OUT)
} catch (e) {
  print('Read failed for ' + IP + ': ' + e)
  exit(1)
}
