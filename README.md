# NextWheel

A fork of Treat Wheel by [ThePedroo](https://github.com/ThePedroo), the general purpose root hiding module, made to work with [NextZygisk](https://github.com/ifoknr/NexTZygisk).

## Features

- C99
- Traceless
- Low complexity
- Live dashboard that shows when hiding is working, when it crashed, and when Zygisk stopped
- Works with NextZygisk as well as ReZygisk

## Requirements

- Magisk Official, KernelSU Official (or API compliant), or APatch
- NextZygisk, or ReZygisk 508 or higher
- Android 7.1 or higher

## Support

Questions and bugs about NextWheel go to [this repository's issues](https://github.com/ifoknr/NextWheel/issues). Please don't report NextWheel problems to the Treat Wheel developers.

> [!WARNING]
> Absolutely NO support will be given if requirements are NOT met.

## Usage

The only feature that requires setup is RVU (ReVanced Umount). ReVanced modules MUST include a `tw_config` file in their module folder with the following content:

```properties
module_type=revanced
allow_umount=true
```

Which will allow NextWheel to enumerate the amount of ReVanced modules -- hence amount of mounts it should find -- and umount them. This is the same file Treat Wheel reads, so modules that already support Treat Wheel work unchanged.

> [!NOTE]
> NextWheel keeps Treat Wheel's module ID (`treat_wheel`) and data folder (`/data/adb/treat_wheel`), so it installs over an existing Treat Wheel and keeps its settings. Only one of the two can be installed at a time.

## Developers

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/ifoknr"><img src="https://github.com/ifoknr.png?size=120" width="96" alt="ifoknr"><br><b>ifoknr</b></a><br>
      NextWheel
    </td>
    <td align="center">
      <a href="https://github.com/ThePedroo"><img src="https://github.com/ThePedroo.png?size=120" width="96" alt="ThePedroo"><br><b>ThePedroo</b></a><br>
      Treat Wheel
    </td>
    <td align="center">
      <a href="https://github.com/RainyXeon"><img src="https://github.com/RainyXeon.png?size=120" width="96" alt="RainyXeon"><br><b>RainyXeon</b></a><br>
      Treat Wheel and WebUI
    </td>
  </tr>
</table>

NextWheel is built on the work of the Treat Wheel developers and [The PerformanC Organization](https://github.com/PerformanC).

## License

NextWheel, like Treat Wheel, is licensed under [AGPLv3 License](LICENSE). You can read more about it on [Open Source Initiative](https://opensource.org/licenses/AGPL-3.0).
