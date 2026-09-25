import { configure } from '@testing-library/dom';

// A full run renders many screens in parallel; on a slow machine the first render of a file can
// take longer than the 1s that findBy* waits by default.
configure({ asyncUtilTimeout: 10_000 });
