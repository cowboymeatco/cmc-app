// Web Serial API — the subset the Rice Lake reader uses. TypeScript's dom lib
// doesn't ship these yet (Chrome and Edge have them; Safari and Firefox don't),
// so the few shapes we touch are declared here. Everything is optional-guarded
// at runtime through `navigator.serial`.

interface SerialPortInfo {
  usbVendorId?:  number
  usbProductId?: number
}

interface SerialOptions {
  baudRate:     number
  dataBits?:    7 | 8
  stopBits?:    1 | 2
  parity?:      'none' | 'even' | 'odd'
  bufferSize?:  number
  flowControl?: 'none' | 'hardware'
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface SerialPortRequestOptions {
  filters?: SerialPortInfo[]
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface Navigator {
  readonly serial?: Serial
}
