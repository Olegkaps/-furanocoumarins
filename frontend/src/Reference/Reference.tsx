import { useEffect, useState, type FC, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowUpRightFromSquare, Check } from '@gravity-ui/icons';
import { api } from '../Admin/utils';
import FullNavigation from '../FullNavigation/FullNavigation';

interface BibtexEntry {
  author?: string;
  title?: string;
  journal?: string;
  year?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
}

const parseBibtex = (bibtexStr: string): BibtexEntry | null => {
  const entry: BibtexEntry = {};
  const lines = bibtexStr.trim().split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*([a-zA-Z]+)\s*=\s*\{(.+?)\},?\s*$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();

      const cleanedValue = value.replace(/^[\{\}"]|(?:[\}]|")$/g, '').trim();

      entry[key as keyof BibtexEntry] = cleanedValue;
    }
  }

  if (!entry.author || !entry.title) {
    return null;
  }

  return entry;
};

const BibtexCitation: FC<{ bibtex: string }> = ({ bibtex }) => {
  const [citation, setCitation] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const parsed = parseBibtex(bibtex);

    if (!parsed) {
      setCitation(<p className="text-red-500">incorrect BibTeX</p>);
      return;
    }

    const authors = parsed.author
      ?.split(' and ')
      .map((name) => name.trim())
      .join(', ');

    const title = <em>{parsed.title}</em>;

    let journalInfo = '';
    if (parsed.journal) {
      journalInfo += parsed.journal;
      if (parsed.volume) journalInfo += `, ${parsed.volume}`;
      if (parsed.number) journalInfo += `(${parsed.number})`;
      if (parsed.pages) journalInfo += `: ${parsed.pages}`;
    }

    const year = parsed.year ? `(${parsed.year})` : '';

    const doiLink = parsed.doi ? (
      <a
        href={`https://doi.org/${parsed.doi}`}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline"
      >
        DOI: {parsed.doi}
      </a>
    ) : null;

    const urlLink = parsed.url ? (
      <a
        href={parsed.url}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline"
      >
        link<ArrowUpRightFromSquare />
      </a>
    ) : null;

    setCitation(
      <div className="bibtex-citation space-y-1">
        <div>
          <strong>{authors}.</strong>{' '}
          {title}.{' '}
          {journalInfo && `${journalInfo}.`}{' '}
          {year}
        </div>
        {doiLink && <div className="text-sm">{doiLink}</div>}
        {urlLink && <div className="text-sm">{urlLink}</div>}
      </div>
    );
  }, [bibtex]);

  return citation;
};

export function Reference() {
  const { article_id } = useParams();
  const [isClicked, setIsClicked] = useState(false);

  const [referenceData, setReferenceData] = useState('');
  if (referenceData === '') {
    api
      .get('/article/' + article_id)
      .catch((err) => err.response)
      .then((res) => setReferenceData(res?.['data']?.['val'] ?? ''));
  }

  return (
    <>
      <FullNavigation />
      <div>
        <BibtexCitation bibtex={referenceData} />
        {referenceData !== '' && (
          <button
            style={
              !isClicked
                ? { border: '1px solid grey', borderRadius: '15px', padding: '10px' }
                : {
                    border: '1px solid grey',
                    borderRadius: '15px',
                    padding: '10px',
                    backgroundColor: 'lightgreen',
                  }
            }
            onClick={async () => {
              await navigator.clipboard.writeText(referenceData);
              setIsClicked(true);
              setTimeout(() => setIsClicked(false), 1500);
            }}
            type="button"
          >
            &nbsp;&nbsp;&nbsp;Copy raw BibTeX {isClicked ? <Check /> : <>&nbsp;&nbsp;&nbsp;</>}
          </button>
        )}
      </div>
    </>
  );
}
