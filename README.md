# docs

Source code for `docs.allora.network`

Built with `yarn` and NodeJS `v20.12.2`

## Instructions

**Development:**
```
yarn dev
```
then navigate to http://localhost:3000

**Production:**
```
yarn build && yarn start
```

## Fix Links

To fix links in the markdown files, run the following command:
```
yarn fixlinks
```

If duplicate filenames are desirable, one can run the command as:
```
yarn fixlinks | grep Broken
```
to only see the broken links, no logs of duplicate filenames.

## License

[Apache 2.0](LICENSE)
