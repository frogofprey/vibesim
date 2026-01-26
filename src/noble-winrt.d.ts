declare module 'noble-winrt' {
  export interface Advertisement {
    localName?: string;
    serviceUuids?: string[];
    serviceData?: Array<{
      uuid: string;
      data: Buffer;
    }>;
    manufacturerData?: Buffer;
    txPowerLevel?: number;
  }

  export type PeripheralState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

  export interface Peripheral {
    id: string;
    address: string;
    addressType: string;
    connectable: boolean;
    advertisement: Advertisement;
    rssi: number;
    services?: Service[];
    state: PeripheralState;
    
    connect(callback?: (error?: string) => void): void;
    disconnect(callback?: () => void): void;
    
    on(event: 'connect', listener: (error?: string) => void): void;
    on(event: 'disconnect', listener: (error?: string) => void): void;
    on(event: 'rssiUpdate', listener: (rssi: number) => void): void;
    on(event: 'servicesDiscover', listener: (services: Service[]) => void): void;
    
    removeListener(event: 'connect', listener: (error?: string) => void): void;
    removeListener(event: 'disconnect', listener: (error?: string) => void): void;
    removeListener(event: 'rssiUpdate', listener: (rssi: number) => void): void;
    removeListener(event: 'servicesDiscover', listener: (services: Service[]) => void): void;
    
    discoverServices(serviceUuids?: string[], callback?: (error: string | null, services: Service[]) => void): void;
    discoverAllServicesAndCharacteristics(callback?: (error: string | null, services: Service[]) => void): void;
  }

  export interface Service {
    uuid: string;
    name?: string;
    type?: string;
    characteristics?: Characteristic[];
    
    discoverCharacteristics(characteristicUuids?: string[], callback?: (error: string | null, characteristics: Characteristic[]) => void): void;
  }

  export interface Characteristic {
    uuid: string;
    name?: string;
    type?: string;
    properties?: string[];
    serviceUuid?: string;
    
    read(callback?: (error: string | null, data: Buffer) => void): void;
    write(data: Buffer, withoutResponse: boolean, callback?: (error: string | null) => void): void;
    subscribe(callback?: (error: string | null) => void): void;
    unsubscribe(callback?: (error: string | null) => void): void;
    
    on(event: 'read', listener: (data: Buffer, isNotification: boolean) => void): void;
    on(event: 'write', listener: (error: string | null) => void): void;
    on(event: 'notify', listener: (state: boolean) => void): void;
    
    removeListener(event: 'read', listener: (data: Buffer, isNotification: boolean) => void): void;
    removeListener(event: 'write', listener: (error: string | null) => void): void;
    removeListener(event: 'notify', listener: (state: boolean) => void): void;
  }

  export type NobleState = 'unknown' | 'resetting' | 'unsupported' | 'unauthorized' | 'poweredOff' | 'poweredOn';

  export interface Noble {
    state: NobleState;
    
    on(event: 'stateChange', listener: (state: NobleState) => void): void;
    on(event: 'discover', listener: (peripheral: Peripheral) => void): void;
    on(event: 'scanStart', listener: () => void): void;
    on(event: 'scanStop', listener: () => void): void;
    on(event: 'warning', listener: (message: string) => void): void;
    
    removeListener(event: 'stateChange', listener: (state: NobleState) => void): void;
    removeListener(event: 'discover', listener: (peripheral: Peripheral) => void): void;
    removeListener(event: 'scanStart', listener: () => void): void;
    removeListener(event: 'scanStop', listener: () => void): void;
    removeListener(event: 'warning', listener: (message: string) => void): void;
    
    startScanning(serviceUuids?: string[], allowDuplicates?: boolean): void;
    stopScanning(): void;
  }

  const noble: Noble;
  export default noble;
}
