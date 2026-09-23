import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePastedTranscript} from '../electron/pasted-transcript';

test('decodes subtitle entities once without interpreting nested entities again',()=>{
  const transcript=parsePastedTranscript('1\n00:00:00,000 --> 00:00:03,000\nA &amp;lt; B &amp; C &#x41;',3);
  const words=transcript.segments.flatMap(segment=>segment.words).map(word=>word.text).join('');
  assert.equal(words,'A&lt;B&CA');
});

test('removes markup even when its angle brackets are encoded',()=>{
  const transcript=parsePastedTranscript('1\n00:00:00,000 --> 00:00:03,000\n&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E; safe',3);
  const text=transcript.segments.map(segment=>segment.text).join(' ');
  assert.equal(text,'alert ( 1 ) safe');
});
